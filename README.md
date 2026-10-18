# Kosh

A private, end-to-end encrypted personal finance app. Next.js on Vercel, Supabase for auth and storage.

**Your financial data is encrypted in your browser before it is uploaded.** The database holds only ciphertext. Nobody with access to Supabase or Vercel, including the app's author, can read it.

## What it does

- Accounts, transactions, budgets, recurring bills, savings goals, and a "safe to spend" figure for the month
- Auto-capture of UPI payments from bank SMS / app notifications on Android (see below)
- CSV statement import with UPI-reference de-duplication
- Automatic categorisation: your own learned rules first, then a built-in merchant list
- Multi-user: every user has their own vault, enforced by Row Level Security *and* by encryption

## Privacy model

| Layer | Protects against |
|---|---|
| Row Level Security (`auth.uid() = user_id`) | One user querying another's rows |
| AES-256-GCM, key never leaves your device | The database, backups, dashboard access, a leaked service key |
| Argon2id (t=3, m=19 MiB) passphrase → key-wrapping key | Offline guessing of the wrapped key |
| AAD binds each ciphertext to user + kind + row id | Rows being swapped between users or records |

```
passphrase ─Argon2id→ KEK ─wraps→ DK (random 256-bit) ──encrypts──► every record
recovery key ───────────────wraps→ DK (second copy)
DK also wraps the ingest PRIVATE key; the PUBLIC key is stored in the clear.
```

**You must keep your recovery key.** If you lose both your passphrase and your recovery key, your data cannot be recovered by anyone. That is the point of end-to-end encryption.

### Honest limits

- **The SMS webhook sees message text briefly.** The server must parse the SMS, so it holds plaintext in memory for that request, then seals the result to your public key. It does not log or store bodies. If that is unacceptable, don't use auto-capture; use statement import.
- **No server-side AI categorisation.** It would require sending plaintext to a server.
- **A compromised deployment could serve malicious JavaScript.** This is inherent to any web-delivered E2EE app. A strict nonce-based CSP reduces the risk; it doesn't remove it.
- **Metadata is visible to the server:** that you have an account, row counts, kinds, sizes and timestamps.
- Processed webhook events stay as small tombstone rows (still ciphertext).

## UPI auto-capture

UPI apps do not expose a personal API, and the Account Aggregator framework isn't open to individuals. So Kosh uses the signal every payment already produces: the bank's SMS.

1. Open **Auto-capture** in the app and create a token.
2. In an Android SMS-forwarder app (or MacroDroid / Tasker), forward bank transaction SMS to `POST https://<your-app>/api/ingest` with `Authorization: Bearer <token>` and JSON body `{"text": "<sms body>"}`.
3. Add each account's last 4 digits so payments land in the right account.

OTPs, failed payments, mandates and due reminders are discarded automatically.

**Parser coverage:** the parser is tested on synthetic messages in common HDFC / SBI / Axis / GPay styles. Real banks vary; add real (redacted) samples to `tests/ingest.test.ts` and extend `src/lib/ingest/parse-upi.ts` as you find misses. Unparsed messages are ignored, never guessed.

## Setup

1. Create a Supabase project and run `supabase/migrations/0001_init.sql` (SQL editor or `supabase db push`).
2. In Supabase → Auth → URL Configuration, set the **Site URL** to your Vercel URL and add `https://<your-app>/auth/callback` as a redirect URL.
3. Set environment variables (locally in `.env.local`, and in Vercel):

   ```
   NEXT_PUBLIC_SUPABASE_URL=...
   NEXT_PUBLIC_SUPABASE_ANON_KEY=...        # publishable key; safe in the browser
   INGEST_DEDUPE_SECRET=...                 # openssl rand -base64 32
   ```
   No service-role key is used anywhere.
4. `npm install && npm run dev`, or deploy to Vercel.

## Development

```
npm test          # crypto, parser, categoriser, selectors, money, dates, csv
npm run typecheck
npm run build
```

## Structure

```
src/lib/crypto     key hierarchy, AES-GCM envelopes, ECIES, recovery key
src/lib/ingest     UPI/SMS parser and categoriser
src/lib/domain     types and in-memory selectors (all aggregation is client-side)
src/app/api/ingest SMS webhook
supabase/migrations schema, RLS, ingest RPCs
```

MIT licensed.
