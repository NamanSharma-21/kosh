'use client';

import { useState } from 'react';
import { useData } from '@/components/data-context';
import { Flash, Money } from '@/components/ui';
import { accountBalances } from '@/lib/domain/selectors';
import { ACCOUNT_TYPES, type AccountType } from '@/lib/domain/types';
import { parseMoney } from '@/lib/money';

export default function Accounts() {
  const { data, save, remove } = useData();
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const balances = accountBalances(data);

  async function run(fn: () => Promise<string | void>) {
    setMsg({});
    try {
      const ok = await fn();
      if (ok) setMsg({ ok });
    } catch (e) {
      setMsg({ error: e instanceof Error ? e.message : 'Something went wrong.' });
    }
  }

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    await run(async () => {
      const opening = parseMoney(String(f.get('opening')) || '0');
      if (opening === null) throw new Error('Enter a valid opening balance.');
      const last4 = String(f.get('last4')).trim();
      if (last4 && !/^\d{4}$/.test(last4)) throw new Error('Last 4 digits must be exactly 4 numbers.');
      await save('account', { name: String(f.get('name')).trim(), type: String(f.get('type')) as AccountType, openingBalance: opening, last4: last4 || undefined });
      form.reset();
      return 'Account added.';
    });
  }

  return (
    <div className="stack">
      <div className="page-head"><h1>Accounts</h1></div>
      <Flash {...msg} />
      <section className="card">
        <h2>Add an account</h2>
        <form className="form-row" onSubmit={add}>
          <label className="field"><span>Name</span><input name="name" required maxLength={60} placeholder="HDFC Savings" /></label>
          <label className="field small"><span>Type</span><select name="type">{ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
          <label className="field small"><span>Opening balance</span><input name="opening" inputMode="decimal" placeholder="0" /></label>
          <label className="field small"><span>Last 4 digits</span><input name="last4" inputMode="numeric" maxLength={4} placeholder="1234" /></label>
          <button>Add</button>
        </form>
        <p className="sub" style={{ marginTop: 8 }}>The last 4 digits let auto-captured UPI/SMS payments land in the right account.</p>
      </section>
      <section className="card">
        {data.accounts.length === 0 ? <p className="empty">No accounts yet.</p> : (
          <ul className="rows">
            {data.accounts.map((a) => (
              <li key={a.id}>
                <span>{a.name} <span className="muted">· {a.type}{a.last4 ? ` ·· ${a.last4}` : ''}</span></span>
                <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <Money value={balances.get(a.id) ?? 0} />
                  <button className="danger small" onClick={() => run(async () => {
                    if (data.transactions.some((t) => t.accountId === a.id)) throw new Error(`${a.name} still has transactions. Delete or move them first.`);
                    if (confirm(`Delete ${a.name}?`)) await remove('account', a.id);
                  })}>Delete</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
