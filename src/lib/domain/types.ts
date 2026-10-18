import type { Cadence } from '../dates';

export type RecordKind =
  | 'account'
  | 'category'
  | 'transaction'
  | 'bill'
  | 'goal'
  | 'contribution'
  | 'rule'
  | 'settings';

export type AccountType = 'checking' | 'savings' | 'credit' | 'cash' | 'investment';
export const ACCOUNT_TYPES: AccountType[] = ['checking', 'savings', 'credit', 'cash', 'investment'];
/** Accounts whose balance counts as spendable money. */
export const LIQUID_TYPES: AccountType[] = ['checking', 'cash'];

/** Everything below is the decrypted payload; the row id lives on the record. */
export interface Account {
  id: string;
  name: string;
  type: AccountType;
  /** Minor units. */
  openingBalance: number;
  /** Last 4 digits, used to match incoming UPI/SMS to this account. */
  last4?: string;
  archived?: boolean;
}

export interface Category {
  id: string;
  name: string;
  kind: 'expense' | 'income';
  /** Monthly budget in minor units; 0 = none. */
  monthlyBudget: number;
}

export interface Transaction {
  id: string;
  date: string;
  /** Signed minor units; negative = money out. */
  amount: number;
  payee: string;
  note?: string;
  accountId: string;
  categoryId: string | null;
  isTransfer?: boolean;
  /** UPI reference / UTR, used to dedupe SMS and statements. */
  ref?: string;
  source?: 'manual' | 'sms' | 'import';
  /** Captured automatically but uncategorised or uncertain. */
  needsReview?: boolean;
}

export interface Bill {
  id: string;
  name: string;
  amount: number;
  cadence: Cadence;
  nextDue: string;
  accountId: string | null;
  categoryId: string | null;
  active: boolean;
}

export interface Goal {
  id: string;
  name: string;
  target: number;
  deadline: string | null;
  accountId: string | null;
  archived?: boolean;
}

export interface Contribution {
  id: string;
  goalId: string;
  date: string;
  amount: number;
}

export interface CategoryRule {
  id: string;
  match: string;
  categoryId: string;
}

export interface Settings {
  id: string;
  /** Account to use when an SMS names no recognisable account. */
  defaultAccountId?: string;
}

export interface KindMap {
  account: Account;
  category: Category;
  transaction: Transaction;
  bill: Bill;
  goal: Goal;
  contribution: Contribution;
  rule: CategoryRule;
  settings: Settings;
}

/** Shape of the decrypted event the webhook seals for the browser. */
export interface IngestPayload {
  direction: 'debit' | 'credit';
  amount: number;
  merchant: string;
  ref?: string;
  acct4?: string;
  /** ISO date from the message, if any. */
  date?: string;
  vpa?: string;
  /** Wall-clock receipt time (ISO). */
  receivedAt: string;
  /** Original text, kept so the user can see what was parsed. */
  text: string;
}

export interface Data {
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  bills: Bill[];
  goals: Goal[];
  contributions: Contribution[];
  rules: CategoryRule[];
  settings: Settings | null;
}

export const EMPTY_DATA: Data = {
  accounts: [],
  categories: [],
  transactions: [],
  bills: [],
  goals: [],
  contributions: [],
  rules: [],
  settings: null,
};

export const DEFAULT_CATEGORIES: Omit<Category, 'id'>[] = [
  ...['Food & Dining', 'Groceries', 'Transport', 'Shopping', 'Bills', 'Entertainment', 'Health', 'Education', 'Travel', 'Rent', 'Other'].map(
    (name) => ({ name, kind: 'expense' as const, monthlyBudget: 0 }),
  ),
  ...['Salary', 'Other income'].map((name) => ({ name, kind: 'income' as const, monthlyBudget: 0 })),
];
