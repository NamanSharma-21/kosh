import { daysBetween } from './dates';

export type Pace = 'none' | 'ok' | 'ahead' | 'over';

/** Compare spending so far against a straight-line pace through the month. */
export function paceStatus(spent: number, budget: number, dayOfMonth: number, daysInThisMonth: number): Pace {
  if (budget <= 0) return 'none';
  if (spent > budget) return 'over';
  const expected = (budget * dayOfMonth) / daysInThisMonth;
  return spent > expected * 1.1 ? 'ahead' : 'ok';
}

/** Amount to set aside this month to hit a goal by its deadline. */
export function monthlyNeed(target: number, saved: number, deadline: string | null, today: string): number {
  if (!deadline || saved >= target) return 0;
  const days = Math.max(0, daysBetween(today, deadline));
  const months = Math.max(1, Math.ceil(days / 30.44));
  return Math.ceil((target - saved) / months);
}

export interface SafeToSpendInput {
  /** Balance across spendable accounts (checking + cash). */
  liquid: number;
  /** Money in spendable accounts already earmarked for goals. */
  earmarked: number;
  /** Bills falling due between today and the end of the month. */
  billsDue: number;
  /** Goal contributions still to make this month. */
  goalsDue: number;
}

export function computeSafeToSpend(i: SafeToSpendInput) {
  const committed = i.earmarked + i.billsDue + i.goalsDue;
  return { ...i, committed, safe: i.liquid - committed };
}
