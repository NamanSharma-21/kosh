import { describe, expect, it } from 'vitest';
import { mapCsv, parseCSV, parseDateLoose } from '../src/lib/csv';

describe('parseCSV', () => {
  it('handles quotes, commas, CRLF and BOM', () => {
    const rows = parseCSV('﻿a,b\r\n"x, y","say ""hi"""\r\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
    ]);
  });
  it('drops blank lines', () => {
    expect(parseCSV('a,b\n\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('parseDateLoose', () => {
  it('reads ISO dates', () => {
    expect(parseDateLoose('2026-10-18')).toBe('2026-10-18');
    expect(parseDateLoose('2026-10-18T10:00:00')).toBe('2026-10-18');
  });
  it('reads day-first by default and month-first on request', () => {
    expect(parseDateLoose('05/10/2026')).toBe('2026-10-05');
    expect(parseDateLoose('05/10/2026', true)).toBe('2026-05-10');
    expect(parseDateLoose('5-10-26')).toBe('2026-10-05');
  });
  it('rejects impossible dates', () => {
    expect(parseDateLoose('31/02/2026')).toBeNull();
    expect(parseDateLoose('hello')).toBeNull();
  });
});

describe('mapCsv', () => {
  it('maps a single signed amount column', () => {
    const { rows, errors } = mapCsv(
      parseCSV('Date,Description,Amount,Category\n2026-10-01,Swiggy,-450.50,Dining\n2026-10-02,Salary,50000,'),
    );
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { date: '2026-10-01', amount: -45050, payee: 'Swiggy', category: 'Dining' },
      { date: '2026-10-02', amount: 5000000, payee: 'Salary', category: undefined },
    ]);
  });

  it('maps separate debit and credit columns', () => {
    const { rows } = mapCsv(
      parseCSV('Date,Narration,Debit,Credit\n01/10/2026,Rent,15000,\n02/10/2026,Refund,,200'),
    );
    expect(rows.map((r) => r.amount)).toEqual([-1500000, 20000]);
  });

  it('reports bad rows without dropping good ones', () => {
    const { rows, errors } = mapCsv(parseCSV('date,amount\nnope,5\n2026-10-01,abc\n2026-10-02,0\n2026-10-03,7'));
    expect(rows).toHaveLength(1);
    expect(errors).toHaveLength(3);
  });

  it('explains missing columns', () => {
    expect(mapCsv(parseCSV('foo,bar\n1,2')).errors[0]).toMatch(/date/i);
    expect(mapCsv(parseCSV('date,foo\n2026-10-01,2')).errors[0]).toMatch(/amount/i);
  });
});
