import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  advance,
  daysBetween,
  isValidISODate,
  monthEnd,
  occurrencesBetween,
  todayISO,
} from '../src/lib/dates';

describe('date math', () => {
  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('clamps month-end when adding months', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
    expect(addMonths('2026-03-10', -3)).toBe('2025-12-10');
  });

  it('advances by cadence', () => {
    expect(advance('2026-10-18', 'weekly')).toBe('2026-10-25');
    expect(advance('2026-10-18', 'monthly')).toBe('2026-11-18');
    expect(advance('2026-10-18', 'yearly')).toBe('2027-10-18');
  });

  it('finds month end and day differences', () => {
    expect(monthEnd('2026-02-10')).toBe('2026-02-28');
    expect(daysBetween('2026-10-18', '2026-10-31')).toBe(13);
  });

  it('validates ISO dates', () => {
    expect(isValidISODate('2026-02-29')).toBe(false);
    expect(isValidISODate('2028-02-29')).toBe(true);
    expect(isValidISODate('2026-13-01')).toBe(false);
    expect(isValidISODate('26-01-01')).toBe(false);
  });

  it('formats today in a timezone', () => {
    const instant = new Date('2026-10-17T20:00:00Z');
    expect(todayISO(instant, 'Asia/Kolkata')).toBe('2026-10-18');
    expect(todayISO(instant, 'UTC')).toBe('2026-10-17');
  });
});

describe('occurrencesBetween', () => {
  it('counts a monthly bill once inside the window', () => {
    expect(occurrencesBetween('2026-10-25', 'monthly', '2026-10-18', '2026-10-31')).toBe(1);
  });

  it('counts nothing when the next due date is after the window', () => {
    expect(occurrencesBetween('2026-11-02', 'monthly', '2026-10-18', '2026-10-31')).toBe(0);
  });

  it('counts every weekly occurrence', () => {
    // 20, 27 Oct fall inside 18–31 Oct
    expect(occurrencesBetween('2026-10-20', 'weekly', '2026-10-18', '2026-10-31')).toBe(2);
  });

  it('counts an overdue bill once plus later occurrences', () => {
    // due 10 Oct (overdue) → counts once; next 17 Oct is also < from, so skipped; 24 and 31 Oct count
    expect(occurrencesBetween('2026-10-10', 'weekly', '2026-10-18', '2026-10-31')).toBe(3);
  });
});
