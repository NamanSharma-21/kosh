import { describe, expect, it } from 'vitest';
import { computeSafeToSpend, monthlyNeed, paceStatus } from '../src/lib/finance';

describe('paceStatus', () => {
  it('has no status without a budget', () => {
    expect(paceStatus(500, 0, 10, 30)).toBe('none');
  });
  it('flags over budget', () => {
    expect(paceStatus(1001, 1000, 10, 30)).toBe('over');
  });
  it('flags spending ahead of a straight-line pace', () => {
    // halfway through the month with 70% spent
    expect(paceStatus(700, 1000, 15, 30)).toBe('ahead');
  });
  it('is ok near the pace', () => {
    expect(paceStatus(520, 1000, 15, 30)).toBe('ok');
  });
});

describe('monthlyNeed', () => {
  it('spreads the remainder across remaining months', () => {
    // 60 days left -> 2 months; (100000-20000)/2
    expect(monthlyNeed(100000, 20000, '2026-12-17', '2026-10-18')).toBe(40000);
  });
  it('asks for everything at once when the deadline is near', () => {
    expect(monthlyNeed(100000, 0, '2026-10-20', '2026-10-18')).toBe(100000);
  });
  it('is zero without a deadline or once reached', () => {
    expect(monthlyNeed(100000, 0, null, '2026-10-18')).toBe(0);
    expect(monthlyNeed(100000, 100000, '2026-12-17', '2026-10-18')).toBe(0);
  });
  it('rounds up so the goal is never short', () => {
    expect(monthlyNeed(10000, 0, '2026-12-17', '2026-10-18')).toBe(5000);
    expect(monthlyNeed(10001, 0, '2026-12-17', '2026-10-18')).toBe(5001);
  });
});

describe('computeSafeToSpend', () => {
  it('subtracts every commitment from liquid cash', () => {
    const r = computeSafeToSpend({ liquid: 100000, earmarked: 10000, billsDue: 30000, goalsDue: 20000 });
    expect(r.committed).toBe(60000);
    expect(r.safe).toBe(40000);
  });
  it('can go negative when overcommitted', () => {
    expect(computeSafeToSpend({ liquid: 1000, earmarked: 0, billsDue: 5000, goalsDue: 0 }).safe).toBe(-4000);
  });
});
