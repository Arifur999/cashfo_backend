import { normaliseMobile, walletNumberFits } from '../referrals/referral-money.js';

// The ways a customer sends the money themselves (Checkout > "Send money
// yourself"), and what they tell us afterwards so an admin can find it.
export const MANUAL_WALLETS = ['BKASH', 'NAGAD', 'ROCKET', 'BANK'] as const;
export type ManualWallet = (typeof MANUAL_WALLETS)[number];

export const isManualWallet = (gateway: string): gateway is ManualWallet => (MANUAL_WALLETS as readonly string[]).includes(gateway);

export interface BankAccountDetails {
  bankName: string;
  branch: string;
  accountName: string;
  accountNumber: string;
  routingNumber: string;
}

// Where the money goes (Admin > Settings > Billing). An empty number or an
// incomplete bank account is a way the checkout doesn't offer.
export interface PaymentAccounts {
  bkash: string;
  nagad: string;
  rocket: string;
  bank: BankAccountDetails;
}

export const EMPTY_PAYMENT_ACCOUNTS: PaymentAccounts = {
  bkash: '',
  nagad: '',
  rocket: '',
  bank: { bankName: '', branch: '', accountName: '', accountNumber: '', routingNumber: '' },
};

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

// The stored setting, tolerant of a missing or hand-edited value.
export function parsePaymentAccounts(value: unknown): PaymentAccounts {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const bank = raw.bank && typeof raw.bank === 'object' ? (raw.bank as Record<string, unknown>) : {};
  return {
    bkash: str(raw.bkash),
    nagad: str(raw.nagad),
    rocket: str(raw.rocket),
    bank: {
      bankName: str(bank.bankName),
      branch: str(bank.branch),
      accountName: str(bank.accountName),
      accountNumber: str(bank.accountNumber),
      routingNumber: str(bank.routingNumber),
    },
  };
}

// What the checkout shows: only the ways that have somewhere to send to.
export function offeredAccounts(accounts: PaymentAccounts) {
  const { bank } = accounts;
  return {
    ...(accounts.bkash && { BKASH: accounts.bkash }),
    ...(accounts.nagad && { NAGAD: accounts.nagad }),
    ...(accounts.rocket && { ROCKET: accounts.rocket }),
    ...(bank.bankName && bank.accountName && bank.accountNumber && { BANK: bank }),
  } as Partial<Record<'BKASH' | 'NAGAD' | 'ROCKET', string> & { BANK: BankAccountDetails }>;
}

export interface Submission {
  payerAccount: string;
  reference: string;
}

// A TrxID (or a bank's transfer reference) has at least this many letters
// and numbers: shorter is a typo, not a payment we can find.
const REFERENCE_MIN: Record<ManualWallet, number> = { BKASH: 8, NAGAD: 8, ROCKET: 8, BANK: 6 };
const REFERENCE = /^[A-Z0-9][A-Z0-9./_#-]{0,39}$/;

// The customer's details cleaned up -- the number they sent from as
// digits, the TrxID without spaces and in capitals -- or what to fix.
export function normaliseSubmission(
  wallet: ManualWallet,
  payerAccount: string,
  reference: string,
): { value: Submission } | { field: 'payerAccount' | 'reference'; problem: string } {
  let payer: string;
  if (wallet === 'BANK') {
    payer = payerAccount.replace(/\s+/g, ' ').trim();
    if (payer.length < 3 || payer.length > 80) return { field: 'payerAccount', problem: 'Type the name on your bank account' };
  } else {
    payer = normaliseMobile(payerAccount);
    if (!walletNumberFits(wallet, payer)) return { field: 'payerAccount', problem: 'Type the 11-digit number you sent from' };
  }
  const ref = reference.replace(/\s+/g, '').toUpperCase();
  if (!REFERENCE.test(ref)) return { field: 'reference', problem: 'Type the TrxID as it is in the message' };
  if (ref.replace(/[^A-Z0-9]/g, '').length < REFERENCE_MIN[wallet])
    return { field: 'reference', problem: 'This TrxID looks too short. Copy it from the message' };
  return { value: { payerAccount: payer, reference: ref } };
}
