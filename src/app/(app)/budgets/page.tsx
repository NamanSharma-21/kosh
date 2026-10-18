'use client';

import { useState } from 'react';
import { useData } from '@/components/data-context';
import { Bar, Flash, Money, PaceBadge } from '@/components/ui';
import { todayISO } from '@/lib/dates';
import { budgetRows, monthOf } from '@/lib/domain/selectors';
import { parseMoney } from '@/lib/money';

export default function Budgets() {
  const { data, save, remove } = useData();
  const today = todayISO();
  const [month, setMonth] = useState(monthOf(today));
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const rows = budgetRows(data, month, today);

  async function run(fn: () => Promise<string | void>) {
    setMsg({});
    try {
      const ok = await fn();
      if (ok) setMsg({ ok });
    } catch (e) {
      setMsg({ error: e instanceof Error ? e.message : 'Something went wrong.' });
    }
  }

  async function setBudget(id: string, raw: string) {
    const cat = data.categories.find((c) => c.id === id)!;
    const v = parseMoney(raw || '0');
    if (v === null || v < 0) return setMsg({ error: 'Enter a valid amount.' });
    if (v === cat.monthlyBudget) return;
    await run(async () => void (await save('category', { ...cat, monthlyBudget: v })));
  }

  async function addCategory(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    await run(async () => {
      const name = String(f.get('name')).trim();
      if (data.categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) throw new Error('That category already exists.');
      await save('category', { name, kind: 'expense', monthlyBudget: 0 });
      form.reset();
      return 'Category added.';
    });
  }

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Budgets</h1>
        <label className="field small"><span>Month</span><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label>
      </div>
      <Flash {...msg} />
      <section className="card">
        <ul className="rows">
          {rows.map((r) => (
            <li key={r.category.id} style={{ display: 'block' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span>{r.category.name} <PaceBadge pace={r.pace} /></span>
                <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span className="num muted"><Money value={r.spent} /> of</span>
                  <input
                    aria-label={`Monthly budget for ${r.category.name}`}
                    style={{ width: 110 }}
                    inputMode="decimal"
                    defaultValue={r.budget ? (r.budget / 100).toString() : ''}
                    placeholder="No budget"
                    onBlur={(e) => setBudget(r.category.id, e.target.value)}
                  />
                  <button className="danger small" onClick={() => run(() => remove('category', r.category.id))} title="Delete category">×</button>
                </span>
              </div>
              {r.budget > 0 && <Bar value={r.spent} max={r.budget} pace={r.pace} />}
            </li>
          ))}
        </ul>
      </section>
      <section className="card">
        <h2>Add a category</h2>
        <form className="form-row" onSubmit={addCategory}>
          <label className="field"><span>Name</span><input name="name" required maxLength={40} /></label>
          <button>Add</button>
        </form>
      </section>
    </div>
  );
}
