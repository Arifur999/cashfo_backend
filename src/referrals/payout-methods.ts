import type { BankAccountType, PayoutMethod, PayoutMethodType } from '@prisma/client';
import { maskPhone, normaliseMobile, walletNumberFits } from './referral-money.js';

// What a payout method holds, as saved and as copied onto a request.
export interface MethodFields {
  type: PayoutMethodType;
  accountName: string;
  walletNumber: string | null;
  bankName: string | null;
  branch: string | null;
  bankAccountType: BankAccountType | null;
  accountNumber: string | null;
  routingNumber: string | null;
}

export type MethodSnapshot = MethodFields;

export interface MethodInput {
  type: PayoutMethodType;
  accountName?: string | null;
  walletNumber?: string | null;
  bankName?: string | null;
  branch?: string | null;
  bankAccountType?: BankAccountType | null;
  accountNumber?: string | null;
  routingNumber?: string | null;
}

export const METHOD_NAMES: Record<PayoutMethodType, string> = { BKASH: 'bKash', NAGAD: 'Nagad', ROCKET: 'Rocket', BANK: 'Bank' };

const text = (value: string | null | undefined): string | null => {
  const trimmed = value?.replace(/\s+/g, ' ').trim();
  return trimmed ? trimmed : null;
};

// The fields for `input.type`, cleaned up (numbers as digits only), or the
// problem to show. A wallet keeps only its number; a bank account needs the
// bank, the account type, the number and the 9-digit routing number.
export function normaliseMethod(input: MethodInput): { value: MethodFields } | { problem: string } {
  const accountName = text(input.accountName);
  if (!accountName || accountName.length < 2) return { problem: 'Enter the name on the account' };
  if (accountName.length > 80) return { problem: 'The account name is too long' };

  if (input.type !== 'BANK') {
    const walletNumber = input.walletNumber ? normaliseMobile(input.walletNumber) : '';
    if (!walletNumberFits(input.type, walletNumber)) {
      return {
        problem:
          input.type === 'ROCKET'
            ? 'Enter the Rocket number: 11 digits starting with 01 (12 with the last digit)'
            : `Enter the ${METHOD_NAMES[input.type]} number: 11 digits starting with 01`,
      };
    }
    return {
      value: { type: input.type, accountName, walletNumber, bankName: null, branch: null, bankAccountType: null, accountNumber: null, routingNumber: null },
    };
  }

  const bankName = text(input.bankName);
  if (!bankName || bankName.length < 2 || bankName.length > 80) return { problem: 'Enter the bank name' };
  const branch = text(input.branch);
  if (branch && branch.length > 80) return { problem: 'The branch name is too long' };
  if (input.bankAccountType !== 'SAVINGS' && input.bankAccountType !== 'CURRENT') return { problem: 'Choose Savings or Current' };
  const accountNumber = (input.accountNumber ?? '').replace(/[\s-]/g, '');
  if (!/^\d{6,20}$/.test(accountNumber)) return { problem: 'Enter the account number (6 to 20 digits)' };
  const routingNumber = (input.routingNumber ?? '').replace(/[\s-]/g, '');
  if (!/^\d{9}$/.test(routingNumber)) return { problem: 'The routing number has 9 digits' };
  return { value: { type: 'BANK', accountName, walletNumber: null, bankName, branch, bankAccountType: input.bankAccountType, accountNumber, routingNumber } };
}

export const snapshotOf = (method: Pick<PayoutMethod, keyof MethodFields>): MethodSnapshot => ({
  type: method.type,
  accountName: method.accountName,
  walletNumber: method.walletNumber,
  bankName: method.bankName,
  branch: method.branch,
  bankAccountType: method.bankAccountType,
  accountNumber: method.accountNumber,
  routingNumber: method.routingNumber,
});

// A stored snapshot read back; tolerant of a missing field.
export function readSnapshot(json: unknown): MethodSnapshot {
  const raw = (json ?? {}) as Partial<Record<keyof MethodFields, unknown>>;
  const str = (value: unknown) => (typeof value === 'string' ? value : null);
  return {
    type: (str(raw.type) ?? 'BANK') as PayoutMethodType,
    accountName: str(raw.accountName) ?? '',
    walletNumber: str(raw.walletNumber),
    bankName: str(raw.bankName),
    branch: str(raw.branch),
    bankAccountType: str(raw.bankAccountType) as BankAccountType | null,
    accountNumber: str(raw.accountNumber),
    routingNumber: str(raw.routingNumber),
  };
}

// The number a payout goes to: the wallet number, or the bank account.
export const payoutNumberOf = (method: Pick<MethodFields, 'walletNumber' | 'accountNumber'>): string | null => method.walletNumber ?? method.accountNumber;

// "bKash 01711-•••915" / "BRAC Bank •••• 2201", for emails.
export function destinationLabel(method: MethodSnapshot): string {
  if (method.type === 'BANK') return `${method.bankName ?? 'Bank'} •••• ${(method.accountNumber ?? '').slice(-4)}`;
  return `${METHOD_NAMES[method.type]} ${method.walletNumber ? maskPhone(method.walletNumber) : ''}`.trim();
}
