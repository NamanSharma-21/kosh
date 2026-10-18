/**
 * Client-side categorisation. Runs in the browser after decryption, so merchant
 * names and rules never reach the server in plaintext.
 *
 * Order: the user's own rules first (they win), then a built-in merchant
 * dictionary. Anything unmatched is left uncategorised for review.
 */
export interface Rule {
  /** Case-insensitive token(s) to look for in the payee / VPA. */
  match: string;
  /** Category name. */
  category: string;
}

/** Category names are matched against the user's categories by name. */
export const DEFAULT_MERCHANTS: Record<string, string[]> = {
  'Food & Dining': ['swiggy', 'zomato', 'dominos', 'mcdonald', 'kfc', 'starbucks', 'cafe', 'restaurant', 'biryani', 'pizza', 'bakery', 'eatsure', 'box8'],
  Groceries: ['bigbasket', 'blinkit', 'zepto', 'instamart', 'dmart', 'jiomart', 'grofers', 'reliance fresh', 'more retail', 'kirana', 'supermarket', 'vegetable', 'milk'],
  Transport: ['uber', 'ola', 'rapido', 'irctc', 'redbus', 'metro', 'fastag', 'petrol', 'fuel', 'indian oil', 'hpcl', 'bpcl', 'shell'],
  Shopping: ['amazon', 'flipkart', 'myntra', 'ajio', 'meesho', 'nykaa', 'decathlon', 'croma'],
  Bills: ['airtel', 'jio', 'vodafone', 'bsnl', 'electricity', 'bescom', 'tata power', 'gas', 'broadband', 'recharge', 'act fibernet', 'dth'],
  Entertainment: ['netflix', 'spotify', 'hotstar', 'bookmyshow', 'youtube', 'prime video', 'sonyliv', 'steam'],
  Health: ['apollo', 'pharmeasy', '1mg', 'netmeds', 'medplus', 'hospital', 'clinic', 'pharmacy', 'diagnostic'],
  Education: ['udemy', 'coursera', 'unacademy', 'byju', 'school', 'college', 'tuition'],
  Travel: ['makemytrip', 'goibibo', 'cleartrip', 'indigo', 'airindia', 'oyo', 'airbnb', 'booking.com'],
};

export function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9@. ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function has(haystack: string, needle: string): boolean {
  const n = normalise(needle);
  if (!n) return false;
  // whole-token match so "ola" doesn't hit "pistola", "gas" doesn't hit "vegas"
  return new RegExp(`(?:^|[^a-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^a-z0-9])`).test(haystack);
}

export function categorize(payee: string, rules: Rule[], vpa?: string): string | null {
  const hay = normalise(`${payee} ${vpa ?? ''}`);
  if (!hay) return null;
  for (const r of rules) if (has(hay, r.match)) return r.category;
  for (const [category, words] of Object.entries(DEFAULT_MERCHANTS)) {
    if (words.some((w) => has(hay, w))) return category;
  }
  return null;
}

/** Pick a stable matching token to learn from a corrected payee. */
export function learnMatchToken(payee: string, vpa?: string): string | null {
  const name = normalise(payee);
  if (name.length >= 3) return name.split(' ').slice(0, 3).join(' ');
  const handle = vpa?.split('@')[0];
  return handle && handle.length >= 3 ? normalise(handle) : null;
}
