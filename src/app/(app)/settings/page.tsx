'use client';

import { useState } from 'react';
import { useData } from '@/components/data-context';
import { Flash } from '@/components/ui';
import { useVault } from '@/components/vault-context';
import { MIN_PASSPHRASE_LENGTH } from '@/lib/crypto/vault';
import { createClient } from '@/lib/supabase/client';

export default function Settings() {
  const { data, save, remove, wipeAll } = useData();
  const { changePassphrase, email, signOut } = useVault();
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [busy, setBusy] = useState(false);
  const catName = new Map(data.categories.map((c) => [c.id, c.name]));

  async function run(fn: () => Promise<string | void>) {
    setMsg({});
    setBusy(true);
    try {
      const ok = await fn();
      if (ok) setMsg({ ok });
    } catch (e) {
      setMsg({ error: e instanceof Error ? e.message : 'Something went wrong.' });
    } finally {
      setBusy(false);
    }
  }

  async function changePass(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    await run(async () => {
      const next = String(f.get('next'));
      if (next.length < MIN_PASSPHRASE_LENGTH) throw new Error(`New passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`);
      if (next !== String(f.get('confirm'))) throw new Error('The new passphrases do not match.');
      await changePassphrase(String(f.get('old')), next);
      form.reset();
      return 'Passphrase changed. Your recovery key still works.';
    });
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kosh-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function deleteAccount() {
    await run(async () => {
      const { error } = await createClient().rpc('delete_my_account');
      if (error) throw new Error('Could not delete your account.');
      await signOut();
    });
  }

  return (
    <div className="stack">
      <div className="page-head"><h1>Settings</h1><span className="sub">{email}</span></div>
      <Flash {...msg} />

      <section className="card stack">
        <h2>Default account for auto-captured payments</h2>
        <p className="sub">Used when a message doesn’t include an account number you’ve saved.</p>
        <select
          aria-label="Default account"
          value={data.settings?.defaultAccountId ?? ''}
          onChange={(e) => run(async () => void (await save('settings', { ...(data.settings ?? {}), id: data.settings?.id, defaultAccountId: e.target.value || undefined } as never)))}
        >
          <option value="">First account</option>
          {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </section>

      <section className="card stack">
        <h2>Learned categorisation rules</h2>
        <p className="sub">Created when you fix a category. They override the built-in merchant list.</p>
        {data.rules.length === 0 ? <p className="empty">None yet.</p> : (
          <ul className="rows">
            {data.rules.map((r) => (
              <li key={r.id}>
                <span>“{r.match}” → {catName.get(r.categoryId) ?? 'deleted category'}</span>
                <button className="danger small" onClick={() => run(() => remove('rule', r.id))}>Remove</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card stack">
        <h2>Change vault passphrase</h2>
        <form className="form-row" onSubmit={changePass}>
          <label className="field"><span>Current</span><input name="old" type="password" required autoComplete="current-password" /></label>
          <label className="field"><span>New</span><input name="next" type="password" required autoComplete="new-password" /></label>
          <label className="field"><span>Confirm new</span><input name="confirm" type="password" required autoComplete="new-password" /></label>
          <button disabled={busy}>{busy ? 'Working…' : 'Change'}</button>
        </form>
      </section>

      <section className="card stack">
        <h2>Your data</h2>
        <div className="form-row">
          <button className="ghost" onClick={exportJson}>Export everything (JSON, unencrypted)</button>
          <button className="danger" disabled={busy} onClick={() => confirm('Permanently delete all your transactions, accounts, budgets and goals? This cannot be undone.') && run(async () => { await wipeAll(); return 'All data deleted.'; })}>Delete all data</button>
          <button className="danger" disabled={busy} onClick={() => confirm('Permanently delete your account and everything in it? This cannot be undone.') && deleteAccount()}>Delete account</button>
        </div>
        <p className="sub">The export is plaintext on your device — keep it somewhere safe.</p>
      </section>
    </div>
  );
}
