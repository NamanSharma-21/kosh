-- Kosh: end-to-end encrypted personal finance.
-- The database only ever stores ciphertext for financial data. Keys are wrapped
-- client-side; the server never sees a passphrase, recovery key or data key.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- user_keys
create table public.user_keys (
  user_id uuid primary key references auth.users (id) on delete cascade,
  kdf jsonb not null,
  wrapped_dk text not null,
  wrapped_dk_recovery text not null,
  ingest_public_key text not null,
  wrapped_ingest_private text not null,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.user_keys enable row level security;

create policy user_keys_select on public.user_keys for select to authenticated
  using ((select auth.uid()) = user_id);
create policy user_keys_insert on public.user_keys for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy user_keys_update on public.user_keys for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ------------------------------------------------------------------ records
create table public.records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in
    ('account','category','transaction','bill','goal','contribution','rule','settings')),
  payload text not null check (length(payload) <= 65536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index records_user_kind_idx on public.records (user_id, kind);
alter table public.records enable row level security;

create policy records_select on public.records for select to authenticated
  using ((select auth.uid()) = user_id);
create policy records_insert on public.records for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy records_update on public.records for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy records_delete on public.records for delete to authenticated
  using ((select auth.uid()) = user_id);

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger records_touch before update on public.records
  for each row execute function public.touch_updated_at();
create trigger user_keys_touch before update on public.user_keys
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------ ingest_tokens
-- Only a SHA-256 hash of each token is stored; the token itself is shown once.
create table public.ingest_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  token_hash text not null unique,
  label text not null default 'Phone' check (length(label) <= 60),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index ingest_tokens_user_idx on public.ingest_tokens (user_id);
alter table public.ingest_tokens enable row level security;

create policy ingest_tokens_select on public.ingest_tokens for select to authenticated
  using ((select auth.uid()) = user_id);
create policy ingest_tokens_insert on public.ingest_tokens for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy ingest_tokens_update on public.ingest_tokens for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy ingest_tokens_delete on public.ingest_tokens for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ------------------------------------------------------------ ingest_events
-- Sealed (ECIES) to the user's public key. Only the webhook RPC can insert.
create table public.ingest_events (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  token_id uuid references public.ingest_tokens (id) on delete set null,
  sealed text not null check (length(sealed) <= 16384),
  dedupe_key text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
create unique index ingest_events_dedupe_idx on public.ingest_events (user_id, dedupe_key)
  where dedupe_key is not null;
create index ingest_events_pending_idx on public.ingest_events (user_id) where processed_at is null;
alter table public.ingest_events enable row level security;

create policy ingest_events_select on public.ingest_events for select to authenticated
  using ((select auth.uid()) = user_id);
create policy ingest_events_update on public.ingest_events for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy ingest_events_delete on public.ingest_events for delete to authenticated
  using ((select auth.uid()) = user_id);
-- deliberately no insert policy: authenticated clients cannot forge events.

-- --------------------------------------------------------------- ingest RPCs
-- Called by the Next.js webhook with the anon key. The caller proves who they
-- are with the bearer token, so no service-role key is needed anywhere.
create function public.ingest_prepare(p_token text)
returns table (user_id uuid, public_key text)
language sql security definer set search_path = '' stable as $$
  select t.user_id, k.ingest_public_key
  from public.ingest_tokens t
  join public.user_keys k on k.user_id = t.user_id
  where t.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and t.revoked_at is null
  limit 1;
$$;

create function public.ingest_store(p_token text, p_id uuid, p_sealed text, p_dedupe text)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_token public.ingest_tokens%rowtype;
  v_recent int;
  v_inserted int;
begin
  select * into v_token from public.ingest_tokens
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and revoked_at is null;
  if not found then return 'invalid'; end if;

  select count(*) into v_recent from public.ingest_events
  where user_id = v_token.user_id and received_at > now() - interval '1 minute';
  if v_recent >= 30 then return 'rate_limited'; end if;

  insert into public.ingest_events (id, user_id, token_id, sealed, dedupe_key)
  values (p_id, v_token.user_id, v_token.id, p_sealed, p_dedupe)
  on conflict do nothing;
  get diagnostics v_inserted = row_count;

  update public.ingest_tokens set last_used_at = now() where id = v_token.id;
  return case when v_inserted = 1 then 'stored' else 'duplicate' end;
end $$;

revoke all on function public.ingest_prepare(text) from public;
revoke all on function public.ingest_store(text, uuid, text, text) from public;
grant execute on function public.ingest_prepare(text) to anon, authenticated;
grant execute on function public.ingest_store(text, uuid, text, text) to anon, authenticated;

-- ----------------------------------------------------------- account removal
create function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'not authenticated'; end if;
  delete from auth.users where id = (select auth.uid());
end $$;
revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;
