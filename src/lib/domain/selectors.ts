/** Pure, in-memory aggregation over decrypted data. The server can't run these. */
import { daysInMonth, monthEnd, occurrencesBetween, parseISO, addMonths, toISO } from '../dates';
import { computeSafeToSpend, monthlyNeed, paceStatus, type Pace } from '../finance';
import { LIQUID_TYPES, type Account, type Category, type Data, type Goal, type Transaction } from './types';

export const monthOf = (iso: string) => iso.slice(0, 7);

export function accountBalances(d: Data): Map<string, number> {
  const bal = new Map(d.accounts.map((a) => [a.id, a.openingBalance]));
  for (const t of d.transactions) if (bal.has(t.accountId)) bal.set(t.accountId, bal.get(t.accountId)! + t.amount);
  return bal;
}

export function monthTotals(txs: Transaction[], month: string) {
  let income = 0;
  let spent = 0;
  for (const t of txs) {
    if (t.isTransfer || monthOf(t.date) !== month) continue;
    if (t.amount > 0) income += t.amount;
    else spent += -t.amount;
  }
  return { income, spent };
}

/** Spend per category id for a month; null key = uncategorised. */
export function categorySpend(txs: Transaction[], month: string): Map<string | null, number> {
  const out = new Map<string | null, number>();
  for (const t of txs) {
    if (t.isTransfer || t.amount >= 0 || monthOf(t.date) !== month) continue;
    out.set(t.categoryId, (out.get(t.categoryId) ?? 0) + -t.amount);
  }
  return out;
}

export interface BudgetRow {
  category: Category;
  spent: number;
  budget: number;
  pace: Pace;
}

export function budgetRows(d: Data, month: string, today: string): BudgetRow[] {
  const spend = categorySpend(d.transactions, month);
  const { y, m } = parseISO(`${month}-01`);
  const dim = daysInMonth(y, m);
  const day = today.startsWith(month) ? parseISO(today).d : dim;
  return d.categories
    .filter((c) => c.kind === 'expense')
    .map((category) => {
      const spent = spend.get(category.id) ?? 0;
      return { category, spent, budget: category.monthlyBudget, pace: paceStatus(spent, category.monthlyBudget, day, dim) };
    });
}

export interface GoalRow {
  goal: Goal;
  saved: number;
  savedThisMonth: number;
  need: number;
  pct: number;
}

export function goalRows(d: Data, month: string, today: string): GoalRow[] {
  return d.goals
    .filter((g) => !g.archived)
    .map((goal) => {
      const mine = d.contributions.filter((c) => c.goalId === goal.id);
      const saved = mine.reduce((s, c) => s + c.amount, 0);
      const savedThisMonth = mine.filter((c) => monthOf(c.date) === month).reduce((s, c) => s + c.amount, 0);
      return {
        goal,
        saved,
        savedThisMonth,
        need: monthlyNeed(goal.target, saved, goal.deadline, today),
        pct: goal.target > 0 ? Math.min(100, Math.round((saved / goal.target) * 100)) : 0,
      };
    });
}

export function safeToSpend(d: Data, today: string) {
  const month = monthOf(today);
  const end = monthEnd(today);
  const balances = accountBalances(d);
  const liquidIds = new Set(d.accounts.filter((a) => LIQUID_TYPES.includes(a.type) && !a.archived).map((a) => a.id));
  let liquid = 0;
  for (const id of liquidIds) liquid += balances.get(id) ?? 0;

  const rows = goalRows(d, month, today);
  let earmarked = 0;
  let goalsDue = 0;
  for (const r of rows) {
    if (r.goal.accountId && liquidIds.has(r.goal.accountId)) earmarked += r.saved;
    goalsDue += Math.max(0, r.need - r.savedThisMonth);
  }
  let billsDue = 0;
  for (const b of d.bills) {
    if (b.active) billsDue += b.amount * occurrencesBetween(b.nextDue, b.cadence, today, end);
  }
  return computeSafeToSpend({ liquid, earmarked, billsDue, goalsDue });
}

/** Last `n` months (oldest first) of income vs spend for the trend chart. */
export function monthlyTrend(txs: Transaction[], today: string, n = 6) {
  const out: { month: string; income: number; spent: number }[] = [];
  const first = `${monthOf(today)}-01`;
  for (let i = n - 1; i >= 0; i--) {
    const month = monthOf(addMonths(first, -i));
    out.push({ month, ...monthTotals(txs, month) });
  }
  return out;
}

export function netWorth(d: Data) {
  const balances = accountBalances(d);
  let total = 0;
  for (const a of d.accounts) if (!a.archived) total += balances.get(a.id) ?? 0;
  return total;
}

export function accountByLast4(accounts: Account[], last4?: string): Account | undefined {
  if (!last4) return undefined;
  return accounts.find((a) => !a.archived && a.last4 === last4);
}

export function reviewQueue(txs: Transaction[]) {
  return txs.filter((t) => t.needsReview).sort((a, b) => b.date.localeCompare(a.date));
}

export { toISO };
