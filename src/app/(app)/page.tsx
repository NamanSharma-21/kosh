'use client';

import Link from 'next/link';
import { useData } from '@/components/data-context';
import { TrendChart } from '@/components/charts';
import { Bar, Money, PaceBadge, shortDate } from '@/components/ui';
import { addDays } from '@/lib/dates';
import { todayISO } from '@/lib/dates';
import {
  budgetRows,
  categorySpend,
  monthOf,
  monthTotals,
  monthlyTrend,
  netWorth,
  reviewQueue,
  safeToSpend,
} from '@/lib/domain/selectors';

export default function Overview() {
  const { data } = useData();
  const today = todayISO();
  const month = monthOf(today);
  const safe = safeToSpend(data, today);
  const totals = monthTotals(data.transactions, month);
  const trend = monthlyTrend(data.transactions, today, 6);
  const spend = categorySpend(data.transactions, month);
  const review = reviewQueue(data.transactions).length;
  const budgets = budgetRows(data, month, today).filter((b) => b.budget > 0);
  const upcoming = data.bills
    .filter((b) => b.active && b.nextDue <= addDays(today, 14))
    .sort((a, b) => a.nextDue.localeCompare(b.nextDue));
  const names = new Map(data.categories.map((c) => [c.id, c.name]));
  const top = [...spend.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  if (data.accounts.length === 0) {
    return (
      <div className="card stack">
        <h1>Welcome to Kosh</h1>
        <p className="sub">Start by adding the bank accounts you want to track. Everything you enter is encrypted on this device.</p>
        <p><Link className="btn" href="/accounts">Add your first account</Link></p>
      </div>
    );
  }

  return (
    <div className="stack">
      {review > 0 && (
        <p className="notice">
          {review} automatically captured transaction{review > 1 ? 's' : ''} need a category. <Link href="/transactions?review=1">Review now</Link>
        </p>
      )}
      <section className={`card hero ${safe.safe < 0 ? 'negative' : ''}`}>
        <div className="label">Safe to spend this month</div>
        <div className="big"><Money value={safe.safe} /></div>
        <ul>
          <li><span>Spendable balance</span><Money value={safe.liquid} /></li>
          <li><span>Set aside for goals</span><Money value={-(safe.earmarked + safe.goalsDue)} /></li>
          <li><span>Bills still due this month</span><Money value={-safe.billsDue} /></li>
        </ul>
      </section>

      <div className="grid two">
        <section className="card">
          <h2>{month} so far</h2>
          <ul className="rows">
            <li><span>Income</span><Money value={totals.income} /></li>
            <li><span>Spent</span><Money value={totals.spent} /></li>
            <li><span>Net</span><Money value={totals.income - totals.spent} signed /></li>
            <li><span>Net worth</span><Money value={netWorth(data)} /></li>
          </ul>
        </section>
        <section className="card">
          <h2>Top spending</h2>
          {top.length === 0 ? <p className="empty">No spending yet this month.</p> : (
            <ul className="rows">
              {top.map(([id, v]) => (
                <li key={id ?? 'none'}><span>{id ? names.get(id) ?? 'Unknown' : 'Uncategorised'}</span><Money value={v} /></li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card">
        <h2>Last 6 months</h2>
        <TrendChart data={trend} />
      </section>

      <div className="grid two">
        <section className="card">
          <h2>Budgets</h2>
          {budgets.length === 0 ? <p className="empty">Set budgets on the Budgets page.</p> : (
            <ul className="rows">
              {budgets.map((b) => (
                <li key={b.category.id} style={{ display: 'block' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span>{b.category.name} <PaceBadge pace={b.pace} /></span>
                    <span className="num muted"><Money value={b.spent} /> / <Money value={b.budget} /></span>
                  </div>
                  <Bar value={b.spent} max={b.budget} pace={b.pace} />
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          <h2>Bills in the next 14 days</h2>
          {upcoming.length === 0 ? <p className="empty">Nothing due soon.</p> : (
            <ul className="rows">
              {upcoming.map((b) => (
                <li key={b.id}><span>{b.name} <span className="muted">· {shortDate(b.nextDue)}</span></span><Money value={b.amount} /></li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
