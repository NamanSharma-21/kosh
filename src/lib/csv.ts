import { daysInMonth, toISO } from './dates';
import { parseMoney } from './money';

/** Minimal RFC 4180 parser: quotes, escaped quotes, CRLF, BOM. */
export function parseCSV(input: string): string[][] {
  const text = input.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Accepts YYYY-MM-DD, or D/M/Y (or M/D/Y when monthFirst). Returns ISO or null. */
export function parseDateLoose(s: string, monthFirst = false): string | null {
  const t = s.trim();
  let y: number, m: number, d: number;

  let mt = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(t);
  if (mt) {
    y = +mt[1];
    m = +mt[2];
    d = +mt[3];
  } else {
    mt = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(t);
    if (!mt) return null;
    const a = +mt[1];
    const b = +mt[2];
    y = +mt[3];
    if (y < 100) y += 2000;
    if (monthFirst) {
      m = a;
      d = b;
    } else {
      d = a;
      m = b;
    }
  }
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return toISO(y, m, d);
}

export interface ImportRow {
  date: string;
  /** Signed minor units; negative = money out. */
  amount: number;
  payee: string;
  category?: string;
  /** UPI / bank reference (UTR, RRN) when the statement has one. */
  ref?: string;
}

export interface MapResult {
  rows: ImportRow[];
  errors: string[];
}

export function mapCsv(table: string[][], opts: { monthFirst?: boolean } = {}): MapResult {
  if (table.length < 2) return { rows: [], errors: ['The file needs a header row and at least one data row.'] };

  const header = table[0].map((h) => h.trim().toLowerCase());
  const find = (names: string[]) => header.findIndex((h) => names.includes(h));

  const iDate = find(['date', 'transaction date', 'posted date', 'value date', 'txn date']);
  const iAmt = find(['amount', 'amt']);
  const iDebit = find(['debit', 'withdrawal', 'withdrawals', 'paid out', 'dr']);
  const iCredit = find(['credit', 'deposit', 'deposits', 'paid in', 'cr']);
  const iPayee = find(['description', 'payee', 'narration', 'details', 'memo', 'name', 'particulars']);
  const iCat = find(['category']);
  const iRef = find(['upi ref', 'upi ref no', 'upi reference', 'utr', 'transaction id', 'txn id', 'reference no', 'ref no', 'reference number', 'chq/ref no', 'rrn']);

  if (iDate < 0) return { rows: [], errors: ['No date column found (expected "date").'] };
  if (iAmt < 0 && iDebit < 0 && iCredit < 0) {
    return { rows: [], errors: ['No amount column found (expected "amount", or "debit"/"credit").'] };
  }

  const rows: ImportRow[] = [];
  const errors: string[] = [];

  table.slice(1).forEach((cells, idx) => {
    const line = idx + 2;
    const date = parseDateLoose(cells[iDate] ?? '', opts.monthFirst);
    if (!date) return void errors.push(`Line ${line}: unreadable date "${cells[iDate] ?? ''}".`);

    let amount: number | null;
    if (iAmt >= 0) {
      amount = parseMoney(cells[iAmt] ?? '');
    } else {
      const debit = iDebit >= 0 && (cells[iDebit] ?? '').trim() ? parseMoney(cells[iDebit]) : 0;
      const credit = iCredit >= 0 && (cells[iCredit] ?? '').trim() ? parseMoney(cells[iCredit]) : 0;
      amount = debit === null || credit === null ? null : Math.abs(credit) - Math.abs(debit);
    }
    if (amount === null) return void errors.push(`Line ${line}: unreadable amount.`);
    if (amount === 0) return void errors.push(`Line ${line}: zero amount skipped.`);

    rows.push({
      date,
      amount,
      payee: (iPayee >= 0 ? cells[iPayee] ?? '' : '').trim().slice(0, 120),
      category: iCat >= 0 ? (cells[iCat] ?? '').trim() || undefined : undefined,
      ref: iRef >= 0 ? (cells[iRef] ?? '').trim().replace(/^'/, '') || undefined : undefined,
    });
  });

  return { rows, errors };
}
