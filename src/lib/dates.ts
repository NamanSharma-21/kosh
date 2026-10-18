export type Cadence = 'weekly' | 'monthly' | 'yearly';

const pad = (n: number) => String(n).padStart(2, '0');

export function toISO(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function parseISO(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

/** Today's date (YYYY-MM-DD) in APP_TIMEZONE, or the server's zone if unset. */
export function todayISO(now: Date = new Date(), tz: string | undefined = process.env.APP_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz || undefined,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function addDays(iso: string, n: number): string {
  const { y, m, d } = parseISO(iso);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return toISO(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addMonths(iso: string, n: number): string {
  const { y, m, d } = parseISO(iso);
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return toISO(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

export function advance(iso: string, cadence: Cadence): string {
  if (cadence === 'weekly') return addDays(iso, 7);
  if (cadence === 'monthly') return addMonths(iso, 1);
  return addMonths(iso, 12);
}

export function monthEnd(iso: string): string {
  const { y, m } = parseISO(iso);
  return toISO(y, m, daysInMonth(y, m));
}

export function daysBetween(from: string, to: string): number {
  const a = parseISO(from);
  const b = parseISO(to);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
}

/**
 * How many times a recurring item falls in [from, to] (inclusive).
 * An overdue item (nextDue < from) counts once as due now.
 */
export function occurrencesBetween(nextDue: string, cadence: Cadence, from: string, to: string): number {
  let d = nextDue;
  let count = 0;
  if (d < from) {
    count++;
    for (let i = 0; i < 500 && d < from; i++) d = advance(d, cadence);
  }
  for (let i = 0; i < 500 && d <= to; i++) {
    count++;
    d = advance(d, cadence);
  }
  return count;
}

export function isValidISODate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const { y, m, d } = parseISO(s);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}
