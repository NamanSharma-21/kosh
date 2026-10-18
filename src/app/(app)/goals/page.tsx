'use client';

import { useState } from 'react';
import { useData } from '@/components/data-context';
import { Bar, Flash, Money, shortDate } from '@/components/ui';
import { todayISO } from '@/lib/dates';
import { goalRows, monthOf } from '@/lib/domain/selectors';
import { parseMoney } from '@/lib/money';

export default function Goals() {
  const { data, save, remove } = useData();
  const today = todayISO();
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const rows = goalRows(data, monthOf(today), today);

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
      const target = parseMoney(String(f.get('target')));
      if (!target || target <= 0) throw new Error('Enter a valid target.');
      await save('goal', {
        name: String(f.get('name')).trim(),
        target,
        deadline: String(f.get('deadline')) || null,
        accountId: String(f.get('account')) || null,
      });
      form.reset();
      return 'Goal created.';
    });
  }

  async function contribute(goalId: string, raw: string) {
    await run(async () => {
      const amount = parseMoney(raw);
      if (!amount || amount <= 0) throw new Error('Enter a valid amount.');
      await save('contribution', { goalId, date: today, amount });
      return 'Saved.';
    });
  }

  async function delGoal(id: string) {
    await run(async () => {
      for (const c of data.contributions.filter((x) => x.goalId === id)) await remove('contribution', c.id);
      await remove('goal', id);
    });
  }

  return (
    <div className="stack">
      <div className="page-head"><h1>Goals</h1></div>
      <Flash {...msg} />
      <section className="card">
        <h2>New goal</h2>
        <form className="form-row" onSubmit={add}>
          <label className="field"><span>Name</span><input name="name" required maxLength={60} placeholder="Emergency fund" /></label>
          <label className="field small"><span>Target</span><input name="target" inputMode="decimal" required /></label>
          <label className="field small"><span>Deadline</span><input name="deadline" type="date" /></label>
          <label className="field"><span>Kept in</span><select name="account"><option value="">Not tracked</option>{data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <button>Create</button>
        </form>
      </section>
      {rows.length === 0 ? <p className="empty">No goals yet.</p> : rows.map((r) => (
        <section className="card" key={r.goal.id}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <h2>{r.goal.name}</h2>
            <span className="num"><Money value={r.saved} /> of <Money value={r.goal.target} /> · {r.pct}%</span>
          </div>
          <Bar value={r.saved} max={r.goal.target} />
          <p className="sub" style={{ marginTop: 8 }}>
            {r.goal.deadline ? `By ${shortDate(r.goal.deadline)}` : 'No deadline'}
            {r.need > 0 && <> · set aside <Money value={r.need} /> this month ({r.savedThisMonth > 0 ? <><Money value={r.savedThisMonth} /> done</> : 'none yet'})</>}
          </p>
          <form className="form-row" style={{ marginTop: 10 }} onSubmit={(e) => { e.preventDefault(); const i = e.currentTarget.elements.namedItem('amt') as HTMLInputElement; void contribute(r.goal.id, i.value).then(() => (i.value = '')); }}>
            <label className="field small"><span>Add savings</span><input name="amt" inputMode="decimal" /></label>
            <button className="small">Add</button>
            <button type="button" className="danger small" onClick={() => confirm(`Delete “${r.goal.name}”?`) && delGoal(r.goal.id)}>Delete goal</button>
          </form>
        </section>
      ))}
    </div>
  );
}
