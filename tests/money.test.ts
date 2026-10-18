import { describe, expect, it } from 'vitest';
import { formatMoney, parseMoney } from '../src/lib/money';

describe('parseMoney', () => {
  it('parses plain and decimal amounts', () => {
    expect(parseMoney('12')).toBe(1200);
    expect(parseMoney('12.5')).toBe(1250);
    expect(parseMoney('12.05')).toBe(1205);
    expect(parseMoney('.99')).toBe(99);
  });

  it('handles separators, symbols and signs', () => {
    expect(parseMoney('1,234.50')).toBe(123450);
    expect(parseMoney('₹99')).toBe(9900);
    expect(parseMoney('-80')).toBe(-8000);
    expect(parseMoney('(12.50)')).toBe(-1250);
    expect(parseMoney('+5')).toBe(500);
  });

  it('rejects junk and over-precise values', () => {
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('1.234')).toBeNull();
    expect(parseMoney('.')).toBeNull();
    expect(parseMoney('1.2.3')).toBeNull();
  });

  it('never returns negative zero', () => {
    expect(Object.is(parseMoney('-0'), 0)).toBe(true);
  });
});

describe('formatMoney', () => {
  it('drops decimals for whole amounts', () => {
    expect(formatMoney(150000, 'USD', 'en-US')).toBe('$1,500');
  });
  it('keeps decimals otherwise', () => {
    expect(formatMoney(150050, 'USD', 'en-US')).toBe('$1,500.50');
  });
  it('uses Indian grouping for INR/en-IN', () => {
    expect(formatMoney(12345600, 'INR', 'en-IN')).toContain('1,23,456');
  });
});
