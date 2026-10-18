import { describe, expect, it } from 'vitest';
import { categorize, learnMatchToken } from '../src/lib/ingest/categorize';
import { parseUpiMessage } from '../src/lib/ingest/parse-upi';
import { mapCsv, parseCSV } from '../src/lib/csv';

// NOTE: these are synthetic messages in common bank styles, not captured from
// real accounts. Add redacted real samples here as you collect them.
describe('parseUpiMessage', () => {
  it('parses an HDFC-style debit', () => {
    const r = parseUpiMessage(
      'Sent Rs.250.00 From HDFC Bank A/C *1234 To SWIGGY On 12/03/25 Ref 506212345678 Not You? Call 18002586161',
    );
    expect(r).toMatchObject({ direction: 'debit', amount: 25000, acct4: '1234', ref: '506212345678', date: '2025-03-12' });
    expect(r?.merchant.toLowerCase()).toContain('swiggy');
  });

  it('parses an SBI-style debit', () => {
    const r = parseUpiMessage(
      'Dear UPI user A/C X1234 debited by 80.0 on date 12Mar25 trf to RAVI KUMAR Refno 506212345678. If not u? call 1800111109',
    );
    expect(r).toMatchObject({ direction: 'debit', amount: 8000, ref: '506212345678' });
    expect(r?.merchant).toBe('RAVI KUMAR');
  });

  it('parses an Axis-style UPI string', () => {
    const r = parseUpiMessage('INR 1,499.00 debited A/C no. XX1234 12-03-25 10:15:22 UPI/P2M/506212345678/Netflix Not you? SMS BLOCK');
    expect(r).toMatchObject({ direction: 'debit', amount: 149900, ref: '506212345678', acct4: '1234' });
    expect(r?.merchant).toBe('Netflix');
  });

  it('parses a credit', () => {
    const r = parseUpiMessage(
      'Rs 5000.00 credited to A/C XX1234 on 12-03-25 by UPI Ref No 506212345678 from ravi@okhdfcbank',
    );
    expect(r).toMatchObject({ direction: 'credit', amount: 500000 });
  });

  it('parses a GPay/PhonePe-style notification', () => {
    const r = parseUpiMessage('Paid ₹120 to Chai Point using UPI');
    expect(r).toMatchObject({ direction: 'debit', amount: 12000 });
    expect(r?.merchant).toBe('Chai Point');
  });

  it('does not mistake the available balance for the amount', () => {
    const r = parseUpiMessage('Rs 99.00 debited from A/C XX1234 to NETFLIX UPI Ref 506212345678. Avl Bal Rs 45,000.00');
    expect(r?.amount).toBe(9900);
  });

  it.each([
    'Your OTP is 123456. Do not share it with anyone. Rs 500 UPI',
    'UPI transaction of Rs 500 to SWIGGY failed. Amount will be refunded',
    'Rs 999 will be debited on 15/03 for your Netflix mandate via UPI',
    'Your credit card bill of Rs 12,000 is due on 20/03. Pay now via UPI',
    'Get 20% cashback offer on UPI payments up to Rs 100',
    'Hello, how are you?',
  ])('ignores non-transactions: %s', (msg) => {
    expect(parseUpiMessage(msg)).toBeNull();
  });
});

describe('categorize', () => {
  it('uses the built-in merchant dictionary', () => {
    expect(categorize('SWIGGY', [])).toBe('Food & Dining');
    expect(categorize('Netflix', [])).toBe('Entertainment');
    expect(categorize('BLINKIT', [])).toBe('Groceries');
  });
  it('lets user rules win over defaults', () => {
    expect(categorize('Swiggy Instamart', [{ match: 'swiggy instamart', category: 'Groceries' }])).toBe('Groceries');
  });
  it('matches whole tokens only', () => {
    expect(categorize('Pistola Vegas', [])).toBeNull();
  });
  it('returns null for unknown merchants', () => {
    expect(categorize('Ravi Kumar', [])).toBeNull();
  });
  it('learns a stable token from a payee', () => {
    expect(learnMatchToken('CHAI POINT BLR 0042')).toBe('chai point blr');
  });
});

describe('statement import with references', () => {
  it('captures UPI reference columns for dedupe', () => {
    const t = parseCSV('Date,Narration,Debit,Credit,UPI Ref No\n12/03/2025,UPI-SWIGGY,250.00,,506212345678\n');
    const { rows } = mapCsv(t);
    expect(rows[0]).toMatchObject({ date: '2025-03-12', amount: -25000, ref: '506212345678' });
  });
});
