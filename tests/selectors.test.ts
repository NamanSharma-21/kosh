import { describe, expect, it } from 'vitest';
import { accountBalances, budgetRows, monthTotals, monthlyTrend, safeToSpend } from '../src/lib/domain/selectors';
import { EMPTY_DATA, type Data } from '../src/lib/domain/types';

const data: Data = {
  ...EMPTY_DATA,
  accounts: [
    { id: 'a1', name: 'HDFC', type: 'checking', openingBalance: 100000_00 },
    { id: 'a2', name: 'Emergency', type: 'savings', openingBalance: 50000_00 },
  ],
  categories: [{ id: 'c1', name: 'Food & Dining', kind: 'expense', monthlyBudget: 10000_00 }],
  transactions: [
    { id: 't1', date: '2026-10-05', amount: -2500_00, payee: 'Swiggy', accountId: 'a1', categoryId: 'c1' },
    { id: 't2', date: '2026-10-01', amount: 80000_00, payee: 'Salary', accountId: 'a1', categoryId: null },
    { id: 't3', date: '2026-10-02', amount: -5000_00, payee: 'To savings', accountId: 'a1', categoryId: null, isTransfer: true },
  ],
  bills: [{ id: 'b1', name: 'Rent', amount: 20000_00, cadence: 'monthly', nextDue: '2026-10-25', accountId: 'a1', categoryId: null, active: true }],
  goals: [{ id: 'g1', name: 'Trip', target: 12000_00, deadline: '2027-04-18', accountId: 'a2' }],
  contributions: [{ id: 'k1', goalId: 'g1', date: '2026-10-03', amount: 2000_00 }],
};

describe('selectors', () => {
  it('computes balances from opening balance plus transactions', () => {
    const b = accountBalances(data);
    expect(b.get('a1')).toBe(100000_00 + 80000_00 - 2500_00 - 5000_00);
  });

  it('excludes transfers from income/spend', () => {
    expect(monthTotals(data.transactions, '2026-10')).toEqual({ income: 80000_00, spent: 2500_00 });
  });

  it('rates budget pace', () => {
    const [row] = budgetRows(data, '2026-10', '2026-10-18');
    expect(row.spent).toBe(2500_00);
    expect(row.pace).toBe('ok');
  });

  it('subtracts bills and goal contributions from safe-to-spend', () => {
    const s = safeToSpend(data, '2026-10-18');
    expect(s.liquid).toBe(172500_00);
    expect(s.billsDue).toBe(20000_00);
    expect(s.safe).toBe(s.liquid - s.earmarked - s.billsDue - s.goalsDue);
    expect(s.safe).toBeLessThan(s.liquid);
  });

  it('returns a fixed number of trend months, oldest first', () => {
    const t = monthlyTrend(data.transactions, '2026-10-18', 6);
    expect(t).toHaveLength(6);
    expect(t[5].month).toBe('2026-10');
    expect(t[0].month).toBe('2026-05');
  });
});
