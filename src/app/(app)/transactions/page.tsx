'use client';

import { useMemo, useState } from 'react';
import { useData } from '@/components/data-context';
import { Flash, Money, shortDate } from '@/components/ui';
import { mapCsv, parseCSV } from '@/lib/csv';
import { monthOf } from '@/lib/domain/selectors';
import type { Transaction } from '@/lib/domain/types';
import { todayISO } from '@/lib/dates';
import { categorize } from '@/lib/ingest/categorize';
import { parseMoney } from '@/lib/money';

export default function Transactions() {
  const { data, save, saveMany, remove, correct } = useData();
  const today = todayISO();
  const [month, setMonth] = useState(() => monthOf(today));
  const [account, setAccount] = useState('');
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [reviewOnly, setReviewOnly] = useState(() => typeof window !== 'undefined' && window.location.search.includes('review=1'));
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});

  const accName = useMemo(() => new Map(data.accounts.map((a) => [a.id, a.name])), [data.accounts]);
  const catName = useMemo(() => new Map(data.categories.map((c) => [c.id, c.name])), [data.categories]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.transactions
      .filter((t) => (reviewOnly ? t.needsReview : !month || monthOf(t.date) === month))
      .filter((t) => !account || t.accountId === account)
      .filter((t) => !category || t.categoryId === category)
      .filter((t) => !needle || `${t.payee} ${t.note ?? ''}`.toLowerCase().includes(needle))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 500);
  }, [data.transactions, month, account, category, q, reviewOnly]);

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
      const magnitude = parseMoney(String(f.get('amount')));
      if (magnitude === null || magnitude === 0) throw new Error('Enter a valid amount.');
      const kind = String(f.get('kind'));
      const payee = String(f.get('payee')).trim();
      const accountId = String(f.get('account'));
      if (!accountId) throw new Error('Choose an account.');
      const picked = String(f.get('category')) || null;
      const guessed = kind === 'out' && !picked ? data.categories.find((c) => c.name === categorize(payee, data.rules.map((r) => ({ match: r.match, category: catName.get(r.categoryId) ?? '' }))))?.id ?? null : picked;
      await save('transaction', {
        date: String(f.get('date')),
        amount: kind === 'out' ? -Math.abs(magnitude) : Math.abs(magnitude),
        payee,
        note: String(f.get('note')).trim() || undefined,
        accountId,
        categoryId: guessed,
        source: 'manual',
      });
      form.reset();
      return 'Transaction added.';
    });
  }

  async function importCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await run(async () => {
      if (!data.accounts.length) throw new Error('Add an account first.');
      const targetId = account || data.accounts[0].id;
      const { rows: parsed, errors } = mapCsv(parseCSV(await file.text()));
      if (!parsed.length) throw new Error(errors[0] ?? 'No rows found.');

      const refs = new Set(data.transactions.map((t) => t.ref).filter(Boolean));
      const keys = new Set(data.transactions.map((t) => `${t.accountId}|${t.date}|${t.amount}|${t.payee.toLowerCase()}`));
      const ruleList = data.rules.map((r) => ({ match: r.match, category: catName.get(r.categoryId) ?? '' }));
      const fresh: Omit<Transaction, 'id'>[] = [];
      let dupes = 0;
      for (const r of parsed) {
        const key = `${targetId}|${r.date}|${r.amount}|${r.payee.toLowerCase()}`;
        if ((r.ref && refs.has(r.ref)) || keys.has(key)) {
          dupes++;
          continue;
        }
        if (r.ref) refs.add(r.ref);
        keys.add(key);
        const name = r.category ?? (r.amount < 0 ? categorize(r.payee, ruleList) : null);
        const cat = name ? data.categories.find((c) => c.name.toLowerCase() === name.toLowerCase()) : undefined;
        fresh.push({ date: r.date, amount: r.amount, payee: r.payee, accountId: targetId, categoryId: cat?.id ?? null, ref: r.ref, source: 'import', needsReview: r.amount < 0 && !cat });
      }
      await saveMany('transaction', fresh);
      return `Imported ${fresh.length} into ${accName.get(targetId)}${dupes ? `, skipped ${dupes} duplicates` : ''}${errors.length ? `, ${errors.length} unreadable lines` : ''}.`;
    });
  }

  const expenseCats = data.categories.filter((c) => c.kind === 'expense');

  return (
    <div className="stack">
      <div className="page-head"><h1>Transactions</h1></div>
      <Flash {...msg} />

      <details className="card" open={data.transactions.length === 0}>
        <summary>Add a transaction</summary>
        <form className="form-row" onSubmit={add}>
          <label className="field small"><span>Date</span><input name="date" type="date" defaultValue={today} required /></label>
          <label className="field small"><span>Type</span><select name="kind"><option value="out">Money out</option><option value="in">Money in</option></select></label>
          <label className="field small"><span>Amount</span><input name="amount" inputMode="decimal" placeholder="250" required /></label>
          <label className="field"><span>Payee</span><input name="payee" maxLength={120} required /></label>
          <label className="field"><span>Account</span><select name="account" required>{data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <label className="field"><span>Category</span><select name="category"><option value="">Auto / none</option>{data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label className="field"><span>Note</span><input name="note" maxLength={200} /></label>
          <button>Add</button>
        </form>
      </details>

      <details className="card">
        <summary>Import a bank / UPI statement (CSV)</summary>
        <p className="sub">Columns needed: date and amount (or debit/credit). A UPI reference or UTR column is used to avoid duplicates with auto-captured payments. Imports into the account selected in the filter below (default: first).</p>
        <p><input type="file" accept=".csv,text/csv" onChange={importCsv} /></p>
      </details>

      <section className="card">
        <div className="form-row" style={{ marginBottom: 12 }}>
          <label className="field small"><span>Month</span><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} disabled={reviewOnly} /></label>
          <label className="field"><span>Account</span><select value={account} onChange={(e) => setAccount(e.target.value)}><option value="">All</option>{data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <label className="field"><span>Category</span><select value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All</option>{data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label className="field"><span>Search</span><input value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <label className="check"><input type="checkbox" checked={reviewOnly} onChange={(e) => setReviewOnly(e.target.checked)} />Needs review</label>
        </div>
        {rows.length === 0 ? <p className="empty">{reviewOnly ? 'Nothing needs review.' : 'No transactions match.'}</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Payee</th><th>Account</th><th>Category</th><th className="right">Amount</th><th /></tr></thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id}>
                    <td className="num">{shortDate(t.date)}</td>
                    <td>{t.payee}{t.source === 'sms' && <span className="pill" style={{ marginLeft: 6 }}>auto</span>}{t.needsReview && <span className="pill review" style={{ marginLeft: 6 }}>review</span>}</td>
                    <td className="muted">{accName.get(t.accountId) ?? '—'}</td>
                    <td>
                      <select
                        aria-label={`Category for ${t.payee}`}
                        value={t.categoryId ?? ''}
                        onChange={(e) => run(() => correct(t, e.target.value || null, true))}
                      >
                        <option value="">Uncategorised</option>
                        {(t.amount < 0 ? expenseCats : data.categories).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </td>
                    <td className="right"><Money value={t.amount} signed /></td>
                    <td className="right"><button className="danger small" onClick={() => run(() => remove('transaction', t.id))}>Delete</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
