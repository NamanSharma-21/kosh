'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';
import { decryptJson, encryptJson, ingestAad, recordAad } from '@/lib/crypto/envelope';
import { open as openSealed } from '@/lib/crypto/ecies';
import { categorize, learnMatchToken } from '@/lib/ingest/categorize';
import { accountByLast4 } from '@/lib/domain/selectors';
import {
  DEFAULT_CATEGORIES,
  EMPTY_DATA,
  type Data,
  type IngestPayload,
  type KindMap,
  type RecordKind,
  type Transaction,
} from '@/lib/domain/types';
import { todayISO } from '@/lib/dates';
import { useVault } from './vault-context';

const PAGE = 1000;
const COLLECTION: Record<RecordKind, keyof Data> = {
  account: 'accounts',
  category: 'categories',
  transaction: 'transactions',
  bill: 'bills',
  goal: 'goals',
  contribution: 'contributions',
  rule: 'rules',
  settings: 'settings',
};

interface DataApi {
  data: Data;
  loading: boolean;
  error: string | null;
  inboxCount: number;
  save<K extends RecordKind>(kind: K, value: Omit<KindMap[K], 'id'> & { id?: string }): Promise<KindMap[K]>;
  saveMany<K extends RecordKind>(kind: K, values: (Omit<KindMap[K], 'id'> & { id?: string })[]): Promise<void>;
  remove(kind: RecordKind, id: string): Promise<void>;
  /** Recategorise a transaction and learn a rule from it. */
  correct(tx: Transaction, categoryId: string | null, learn: boolean): Promise<void>;
  refreshInbox(): Promise<number>;
  wipeAll(): Promise<void>;
}

const Ctx = createContext<DataApi | null>(null);
export const useData = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useData outside DataProvider');
  return v;
};

function add(d: Data, kind: RecordKind, value: { id: string }): Data {
  const key = COLLECTION[kind];
  if (kind === 'settings') return { ...d, settings: value as Data['settings'] };
  const list = d[key] as { id: string }[];
  const i = list.findIndex((x) => x.id === value.id);
  const next = i >= 0 ? list.map((x, j) => (j === i ? value : x)) : [...list, value];
  return { ...d, [key]: next };
}

export function DataProvider({ children }: { children: ReactNode }) {
  const { userId, keys } = useVault();
  const supabase = useMemo(() => createClient(), []);
  const [data, setData] = useState<Data>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inboxCount, setInboxCount] = useState(0);
  const dataRef = useRef(data);
  dataRef.current = data;
  const busy = useRef(false);

  const encryptRow = useCallback(
    async (kind: RecordKind, id: string, value: unknown) => ({
      id,
      user_id: userId,
      kind,
      payload: await encryptJson(keys!.dk, value, recordAad(userId, kind, id)),
    }),
    [keys, userId],
  );

  const load = useCallback(async () => {
    if (!keys) return;
    setLoading(true);
    setError(null);
    try {
      let next: Data = { ...EMPTY_DATA, accounts: [], categories: [], transactions: [], bills: [], goals: [], contributions: [], rules: [] };
      for (let from = 0; ; from += PAGE) {
        const { data: rows, error: err } = await supabase
          .from('records')
          .select('id, kind, payload')
          .order('created_at')
          .order('id')
          .range(from, from + PAGE - 1);
        if (err) throw err;
        const batch = await Promise.all(
          rows.map(async (r) => {
            try {
              const v = await decryptJson<{ id: string }>(keys.dk, r.payload, recordAad(userId, r.kind, r.id));
              return { kind: r.kind as RecordKind, v: { ...v, id: r.id } };
            } catch {
              return null; // undecryptable row (wrong key / tampered): skip rather than crash
            }
          }),
        );
        for (const b of batch) if (b) next = add(next, b.kind, b.v);
        if (rows.length < PAGE) break;
      }
      if (next.categories.length === 0 && next.accounts.length === 0) {
        // First run: seed categories.
        const seeded = DEFAULT_CATEGORIES.map((c) => ({ ...c, id: crypto.randomUUID() }));
        const rows = await Promise.all(seeded.map((c) => encryptRow('category', c.id, c)));
        const { error: err } = await supabase.from('records').insert(rows);
        if (err) throw err;
        next = { ...next, categories: seeded };
      }
      setData(next);
    } catch {
      setError('Could not load your data. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [keys, supabase, userId, encryptRow]);

  useEffect(() => {
    void load();
  }, [load]);

  const save: DataApi['save'] = useCallback(
    async (kind, value) => {
      const id = value.id ?? crypto.randomUUID();
      const full = { ...value, id } as KindMap[typeof kind];
      const row = await encryptRow(kind, id, full);
      const { error: err } = await supabase.from('records').upsert(row, { onConflict: 'id' });
      if (err) throw new Error('Could not save. Please try again.');
      setData((d) => add(d, kind, full as { id: string }));
      return full;
    },
    [encryptRow, supabase],
  );

  const saveMany: DataApi['saveMany'] = useCallback(
    async (kind, values) => {
      const fulls = values.map((v) => ({ ...v, id: v.id ?? crypto.randomUUID() }) as KindMap[typeof kind]);
      for (let i = 0; i < fulls.length; i += 200) {
        const rows = await Promise.all(fulls.slice(i, i + 200).map((f) => encryptRow(kind, f.id, f)));
        const { error: err } = await supabase.from('records').upsert(rows, { onConflict: 'id' });
        if (err) throw new Error('Could not save. Please try again.');
      }
      setData((d) => fulls.reduce((acc, f) => add(acc, kind, f as { id: string }), d));
    },
    [encryptRow, supabase],
  );

  const remove: DataApi['remove'] = useCallback(
    async (kind, id) => {
      const { error: err } = await supabase.from('records').delete().eq('id', id);
      if (err) throw new Error('Could not delete. Please try again.');
      setData((d) => {
        if (kind === 'settings') return { ...d, settings: null };
        const key = COLLECTION[kind];
        return { ...d, [key]: (d[key] as { id: string }[]).filter((x) => x.id !== id) };
      });
    },
    [supabase],
  );

  const correct: DataApi['correct'] = useCallback(
    async (tx, categoryId, learn) => {
      await save('transaction', { ...tx, categoryId, needsReview: false });
      const token = learn && categoryId ? learnMatchToken(tx.payee) : null;
      if (token && !dataRef.current.rules.some((r) => r.match === token)) {
        await save('rule', { match: token, categoryId: categoryId! });
      }
    },
    [save],
  );

  /** Pull sealed events from the webhook, decrypt them here, and turn them into transactions. */
  const refreshInbox = useCallback(async () => {
    if (!keys || busy.current) return 0;
    busy.current = true;
    try {
      const { data: events, error: err } = await supabase
        .from('ingest_events')
        .select('id, sealed')
        .is('processed_at', null)
        .order('received_at')
        .limit(200);
      if (err || !events?.length) return 0;

      const d = dataRef.current;
      const catById = new Map(d.categories.map((c) => [c.id, c]));
      const catByName = new Map(d.categories.map((c) => [c.name.toLowerCase(), c]));
      const rules = d.rules
        .map((r) => ({ match: r.match, category: catById.get(r.categoryId)?.name ?? '' }))
        .filter((r) => r.category);
      const seen = new Set(d.transactions.map((t) => t.ref).filter(Boolean) as string[]);
      const created: Omit<Transaction, 'id'>[] = [];

      // Without an account there is nowhere to put transactions; leave events pending.
      if (d.accounts.length === 0) return 0;

      for (const ev of events) {
        let p: IngestPayload;
        try {
          p = await openSealed<IngestPayload>(keys.ingestPrivate, ev.sealed, ingestAad(userId, ev.id));
        } catch {
          continue; // can't be opened with this vault's key; leave it untouched
        }

        // Claim atomically (after a successful decrypt) so two open tabs can't import the same event.
        const { data: claimed } = await supabase
          .from('ingest_events')
          .update({ processed_at: new Date().toISOString() })
          .eq('id', ev.id)
          .is('processed_at', null)
          .select('id');
        if (!claimed?.length) continue;

        if (p.ref && seen.has(p.ref)) continue;
        if (p.ref) seen.add(p.ref);

        const account = accountByLast4(d.accounts, p.acct4) ?? d.accounts.find((a) => a.id === d.settings?.defaultAccountId) ?? d.accounts[0];
        const catName = p.direction === 'debit' ? categorize(p.merchant, rules, p.vpa) : null;
        const category = catName ? catByName.get(catName.toLowerCase()) : undefined;
        created.push({
          date: p.date ?? p.receivedAt.slice(0, 10) ?? todayISO(),
          amount: p.direction === 'debit' ? -p.amount : p.amount,
          payee: p.merchant || p.vpa || 'UPI payment',
          note: undefined,
          accountId: account.id,
          categoryId: category?.id ?? null,
          ref: p.ref,
          source: 'sms',
          needsReview: p.direction === 'debit' && !category,
        });
      }
      if (created.length) await saveMany('transaction', created);
      return created.length;
    } finally {
      busy.current = false;
    }
  }, [keys, supabase, userId, saveMany]);

  // Poll for new events while the app is open and unlocked.
  useEffect(() => {
    if (!keys || loading) return;
    let live = true;
    const tick = async () => {
      const n = await refreshInbox().catch(() => 0);
      if (live) setInboxCount((c) => c + n);
    };
    void tick();
    const t = setInterval(tick, 30_000);
    const onFocus = () => void tick();
    window.addEventListener('focus', onFocus);
    return () => {
      live = false;
      clearInterval(t);
      window.removeEventListener('focus', onFocus);
    };
  }, [keys, loading, refreshInbox]);

  const wipeAll = useCallback(async () => {
    const { error: err } = await supabase.from('records').delete().eq('user_id', userId);
    if (err) throw new Error('Could not delete your data.');
    await supabase.from('ingest_events').delete().eq('user_id', userId);
    setData(EMPTY_DATA);
  }, [supabase, userId]);

  const value: DataApi = { data, loading, error, inboxCount, save, saveMany, remove, correct, refreshInbox, wipeAll };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
