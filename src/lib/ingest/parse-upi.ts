/**
 * Parse Indian bank / UPI-app SMS and notification text into a transaction.
 *
 * Banks word these differently, so this is deliberately conservative: it returns
 * null for anything that isn't clearly a completed debit or credit (OTPs, failed
 * payments, "will be debited" mandates, due reminders), and leaves anything it
 * can't classify to the user's review inbox rather than guessing.
 */
import { parseMoney } from '../money';
import { parseDateLoose } from '../csv';

export interface ParsedUpi {
  direction: 'debit' | 'credit';
  /** Positive minor units (paise). */
  amount: number;
  /** Counterparty name or VPA, best effort. */
  merchant: string;
  /** UPI reference / RRN / UTR, when present. */
  ref?: string;
  /** Last 4 digits of the account, when present. */
  acct4?: string;
  /** ISO date if the message carried one. */
  date?: string;
  vpa?: string;
}

const IGNORE =
  /\b(otp|one[\s-]?time password|verification code|do not share|failed|declined|unsuccessful|reversed|refund(?:ed)?\s+initiated|will be debited|has been scheduled|mandate|autopay (?:request|due)|payment due|due (?:on|by|date)|minimum amount due|bill (?:is )?due|reminder|request(?:ed)? (?:money|₹|rs)|collect request|pending approval|offer|cashback offer|apply now|loan)\b/i;

const AMOUNT = /(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/gi;
const DEBIT_WORDS = /\b(debited|debit|paid|sent|spent|withdrawn|purchase|transferred|deducted|dr\b)/i;
const CREDIT_WORDS = /\b(credited|credit|received|deposited|refund|cr\b)/i;

function firstAmount(text: string): number | null {
  for (const m of text.matchAll(AMOUNT)) {
    const before = text.slice(Math.max(0, m.index! - 24), m.index!).toLowerCase();
    if (/(bal|avl|avail|available|limit|min)\w*\.?\s*(?:bal)?\W*$/.test(before)) continue;
    const minor = parseMoney(m[1]);
    if (minor && minor > 0) return minor;
  }
  // SBI-style: "debited by 80.0" / "credited by 5000" with no currency marker.
  const bare = /\b(?:debited|credited)\s+(?:by|for|with)\s+([\d,]+(?:\.\d{1,2})?)/i.exec(text);
  if (bare) {
    const minor = parseMoney(bare[1]);
    if (minor && minor > 0) return minor;
  }
  return null;
}

function direction(text: string): 'debit' | 'credit' | null {
  const d = DEBIT_WORDS.exec(text);
  const c = CREDIT_WORDS.exec(text);
  if (d && c) return d.index < c.index ? 'debit' : 'credit';
  if (d) return 'debit';
  if (c) return 'credit';
  return null;
}

function cleanMerchant(raw: string): string {
  return raw
    .replace(/\b(?:on|ref|refno|rrn|utr|upi|via|using|from a\/c|a\/c|avl|bal|if not u|if not you|not you)\b.*$/i, '')
    .replace(/[.,;:\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

function findMerchant(text: string, dir: 'debit' | 'credit'): { merchant: string; vpa?: string } {
  // Axis style: UPI/P2M/123456789012/Merchant Name
  const axis = /UPI\/(?:P2[MPA]|[A-Z0-9]+)\/\d{6,}\/([^/\n]+?)(?:\/|\s{2,}|$)/i.exec(text);
  if (axis) return { merchant: cleanMerchant(axis[1]) };

  // GPay / PhonePe / Paytm: "Paid ₹250 to Swiggy", "Sent ₹250 to Ravi"
  const paid = /\b(?:paid|sent)\s+(?:rs\.?|inr|₹)\s*[\d,.]+\s+to\s+([^\n.]+?)(?:\s+(?:using|via|on|from|with)\b|[.\n]|$)/i.exec(text);
  if (paid) return { merchant: cleanMerchant(paid[1]) };

  const vpa = /\b([a-z0-9._-]{2,}@[a-z][a-z0-9]{1,})\b/i.exec(text)?.[1];

  // "credited ... by/from NAME", "; NAME credited"
  if (dir === 'credit') {
    const from = /(?:\bfrom|\bby)\s+(?:vpa\s+)?([A-Za-z0-9 ._&'-]{2,40}?)(?:\s*\(|\s+(?:on|ref|refno|rrn|utr|upi|via)\b|[.;,\n]|$)/i.exec(text);
    if (from && !/a\/c|account/i.test(from[1])) return { merchant: cleanMerchant(from[1]), vpa };
  } else {
    const to = /(?:\bto|\btrf to|\bpaid to|\bat)\s+(?:vpa\s+)?([A-Za-z0-9 ._&'@-]{2,40}?)(?:\s*\(|\s+(?:on|ref|refno|rrn|utr|upi|via|using)\b|[.;,\n]|$)/i.exec(text);
    if (to && !/a\/c|account/i.test(to[1])) return { merchant: cleanMerchant(to[1]), vpa };
  }
  const semi = /;\s*([A-Za-z][A-Za-z0-9 ._&'-]{1,40}?)\s+credited/i.exec(text);
  if (semi) return { merchant: cleanMerchant(semi[1]), vpa };

  return { merchant: vpa ?? '', vpa };
}

function findDate(text: string): string | undefined {
  const num = /\b(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\b/.exec(text);
  if (num) {
    const d = parseDateLoose(num[1]);
    if (d) return d;
  }
  const mon = /\b(\d{1,2})[-\s]([A-Za-z]{3})[a-z]*[-\s,]*(\d{2,4})\b/.exec(text);
  if (mon) {
    const m = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(
      mon[2].toLowerCase(),
    );
    if (m >= 0) {
      const year = +mon[3] < 100 ? 2000 + +mon[3] : +mon[3];
      return parseDateLoose(`${year}-${m + 1}-${+mon[1]}`) ?? undefined;
    }
  }
  return undefined;
}

export function parseUpiMessage(raw: string): ParsedUpi | null {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text || text.length > 2000) return null;
  if (IGNORE.test(text)) return null;
  // Must look like money movement over UPI/bank, not generic marketing.
  if (!/(upi|a\/c|acct|account|paid|sent|debited|credited|vpa)/i.test(text)) return null;

  const amount = firstAmount(text);
  if (!amount) return null;
  const dir = direction(text);
  if (!dir) return null;

  const { merchant, vpa } = findMerchant(text, dir);
  const ref = /(?:ref(?:erence)?(?:\s*(?:no|number|id))?\.?|rrn|utr|txn\s*id)\s*[:#-]?\s*(\d{9,16})/i.exec(text)?.[1]
    ?? /UPI\/[A-Z0-9]+\/(\d{9,16})/i.exec(text)?.[1];
  const acct4 = /(?:a\/c|acct|account|ac)\s*(?:no\.?)?\s*(?:ending|xx+|x+|\*+|no\.?)?\s*[:-]?\s*(?:[xX*]+)?(\d{4})\b/i.exec(text)?.[1];

  return { direction: dir, amount, merchant, ref, acct4, date: findDate(text), vpa };
}
