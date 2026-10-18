/**
 * Money is stored as integer minor units (paise/cents) to avoid float drift.
 * Assumes a 2-decimal currency.
 */

/** Parse user input like "1,234.50", "-80", "(12.5)" or "₹99" into minor units. */
export function parseMoney(input: string): number | null {
  let t = input.trim().replace(/[₹$€£\s]/g, '');
  if (!t) return null;

  let negative = false;
  if (/^\(.*\)$/.test(t)) {
    negative = true;
    t = t.slice(1, -1);
  }
  if (t.startsWith('-')) {
    negative = !negative;
    t = t.slice(1);
  } else if (t.startsWith('+')) {
    t = t.slice(1);
  }

  t = t.replace(/,/g, '');
  if (!/^\d*\.?\d{0,2}$/.test(t) || t === '' || t === '.') return null;

  const [whole, frac = ''] = t.split('.');
  const minor = parseInt(whole || '0', 10) * 100 + parseInt((frac + '00').slice(0, 2), 10);
  if (minor === 0) return 0;
  return negative ? -minor : minor;
}

export function formatMoney(
  minor: number,
  currency: string = process.env.CURRENCY ?? 'INR',
  locale: string = process.env.LOCALE ?? 'en-IN',
): string {
  const whole = minor % 100 === 0;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(minor / 100);
}
