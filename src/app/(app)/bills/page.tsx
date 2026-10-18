'use client';

import { useState } from 'react';
import { useData } from '@/components/data-context';
import { Flash, Money, shortDate } from '@/components/ui';
import { advance, todayISO, type Cadence } from '@/lib/dates';
import { parseMoney } from '@/lib/money';

export default function Bills() {
  const { data, save, remove } = useData();
  const today = todayISO();
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const bills = data.bills.filter((b) => b.active).sort((a, b) => a.nextDue.localeCompare(b.nextDue));

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
      const amount = parseMoney(String(f.get('amount')));
      if (!amount || amount <= 0) throw new Error('Enter a valid amount.');
      await save('bill', {
        name: String(f.get('name')).trim(),
        amount,
        cadence: String(f.get('cadence')) as Cadence,
        nextDue: String(f.get('due')),
        accountId: String(f.get('account')) || null,
        categoryId: null,
        active: true,
      });
      form.reset();
      return 'Bill added.';
    });
  }

  /** Record the payment as a transaction and move the due date forward. */
  async function markPaid(id: string) {
    const b = data.bills.find((x) => x.id === id)!;
    await run(async () => {
      const accountId = b.accountId ?? data.accounts[0]?.id;
      if (!accountId) throw new Error('Add an account first.');
      await save('transaction', { date: today, amount: -b.amount, payee: b.name, accountId, categoryId: b.categoryId, source: 'manual' });
      await save('bill', { ...b, nextDue: advance(b.nextDue, b.cadence) });
      return `${b.name} marked paid.`;
    });
  }

  return (
    <div className="stack">
      <div className="page-head"><h1>Bills</h1></div>
      <Flash {...msg} />
      <section className="card">
        <h2>Add a recurring bill</h2>
        <form className="form-row" onSubmit={add}>
          <label className="field"><span>Name</span><input name="name" required maxLength={60} placeholder="Rent" /></label>
          <label className="field small"><span>Amount</span><input name="amount" inputMode="decimal" required /></label>
          <label className="field small"><span>Repeats</span><select name="cadence"><option value="monthly">Monthly</option><option value="weekly">Weekly</option><option value="yearly">Yearly</option></select></label>
          <label className="field small"><span>Next due</span><input name="due" type="date" defaultValue={today} required /></label>
          <label className="field"><span>Paid from</span><select name="account"><option value="">Any</option>{data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <button>Add</button>
        </form>
      </section>
      <section className="card">
        {bills.length === 0 ? <p className="empty">No bills yet.</p> : (
          <ul className="rows">
            {bills.map((b) => (
              <li key={b.id}>
                <span>
                  {b.name} <span className="muted">· {b.cadence} · due {shortDate(b.nextDue)}</span>
                  {b.nextDue < today && <span className="pill over" style={{ marginLeft: 6 }}>overdue</span>}
                </span>
                <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Money value={b.amount} />
                  <button className="small" onClick={() => markPaid(b.id)}>Mark paid</button>
                  <button className="danger small" onClick={() => run(() => remove('bill', b.id))}>Delete</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
