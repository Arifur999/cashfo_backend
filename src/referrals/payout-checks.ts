import type { MethodSnapshot } from './payout-methods.js';
import { namesMatch, normaliseMobile, samePhone, walletNumberFits } from './referral-money.js';

// What the payout desk checks on a request, worked out when it is read.
// ok = false is a warning for the admin, never a block.
export type PayoutCheckKey = 'NAME_MATCHES' | 'CODE_CONFIRMED' | 'HOLDS_OVER' | 'NO_REFUNDS' | 'FRIEND_PAID_FROM_THIS_NUMBER' | 'WRONG_NUMBER_FOR_METHOD';

export interface PayoutCheck {
  key: PayoutCheckKey;
  ok: boolean;
  // A detail for the row: the confirmation time, how many refunds, ...
  detail: string | null;
}

export interface PayoutCheckInput {
  method: MethodSnapshot;
  user: { name: string; phone: string | null };
  codeConfirmedAt: Date | null;
  // The commissions in the request: was the friend's payment refunded?
  backing: { refunded: boolean }[];
  // Every line's refund window is over.
  holdsOver: boolean;
  // The numbers every friend of this member paid from (Payment.payerAccount).
  friendPayerAccounts: (string | null)[];
  flagSameNumber: boolean;
}

const sameAccount = (a: string, b: string) => a.replace(/[^\d]/g, '') !== '' && a.replace(/[^\d]/g, '') === b.replace(/[^\d]/g, '');

export function payoutChecks(input: PayoutCheckInput): PayoutCheck[] {
  const { method } = input;
  const checks: PayoutCheck[] = [
    { key: 'NAME_MATCHES', ok: namesMatch(method.accountName, input.user.name), detail: method.accountName },
    { key: 'CODE_CONFIRMED', ok: input.codeConfirmedAt !== null, detail: input.codeConfirmedAt?.toISOString() ?? null },
    { key: 'HOLDS_OVER', ok: input.holdsOver, detail: null },
  ];
  const refunds = input.backing.filter((b) => b.refunded).length;
  checks.push({ key: 'NO_REFUNDS', ok: refunds === 0, detail: refunds > 0 ? String(refunds) : null });
  if (input.flagSameNumber) {
    const payoutNumber = method.walletNumber ?? method.accountNumber;
    const hit = input.friendPayerAccounts.some(
      (payer) =>
        Boolean(payer) &&
        ((payoutNumber && (samePhone(payer, payoutNumber) || sameAccount(payer as string, payoutNumber))) || samePhone(payer, input.user.phone)),
    );
    checks.push({ key: 'FRIEND_PAID_FROM_THIS_NUMBER', ok: !hit, detail: null });
  }
  if (method.type !== 'BANK') {
    const fits = walletNumberFits(method.type, method.walletNumber ? normaliseMobile(method.walletNumber) : null);
    checks.push({ key: 'WRONG_NUMBER_FOR_METHOD', ok: fits, detail: method.walletNumber });
  }
  return checks;
}
