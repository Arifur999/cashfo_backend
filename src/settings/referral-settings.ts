import { PayoutMethodType } from '@prisma/client';

// Who earns a commission when an invited friend pays: only members on an
// active paid plan (a free trial doesn't count), or everyone.
export const WHO_CAN_EARN = ['PAID_PLAN', 'EVERYONE'] as const;
export type WhoCanEarn = (typeof WHO_CAN_EARN)[number];

export const PAYOUT_METHOD_TYPES = Object.values(PayoutMethodType);

// The Referral Program's rules (Admin > Referrals & Payouts > Settings), one
// PlatformSetting row per key. Money is whole taka.
export interface ReferralSettings {
  // The program runs: friends get their discount, referrers earn, and
  // members can withdraw.
  programLive: boolean;
  whoCanEarn: WhoCanEarn;
  // Of every payment of an invited friend's, rounded down to the paisa.
  commissionPct: number;
  // Off the friend's first payment.
  friendDiscountPct: number;
  // The refund window: a commission becomes withdrawable this many days
  // after the friend paid.
  holdDays: number;
  minWithdrawal: number;
  // Taken from each withdrawal; the member receives amount - fee.
  withdrawalFee: number;
  // Working days (Sunday to Thursday) the team takes to pay a request.
  payWithinDays: number;
  payoutMethods: PayoutMethodType[];
  // Fraud protection: a sign-up with the referrer's own phone or email
  // earns nothing; a refund inside the window cancels the commission; a
  // withdrawal is flagged when a friend paid from the payout number.
  blockSelf: boolean;
  cancelOnRefund: boolean;
  flagSameNumber: boolean;
  // Most new referrals one person can make in a Dhaka calendar month;
  // null = no limit.
  maxPerMonth: number | null;
}

export const REFERRAL_SETTING_KEYS: Record<keyof ReferralSettings, string> = {
  programLive: 'referral_program_live',
  whoCanEarn: 'referral_who_can_earn',
  commissionPct: 'referral_commission_pct',
  friendDiscountPct: 'referral_friend_discount_pct',
  holdDays: 'referral_hold_days',
  minWithdrawal: 'referral_min_withdrawal',
  withdrawalFee: 'referral_withdrawal_fee',
  payWithinDays: 'referral_pay_within_days',
  payoutMethods: 'referral_payout_methods',
  blockSelf: 'referral_block_self',
  cancelOnRefund: 'referral_cancel_on_refund',
  flagSameNumber: 'referral_flag_same_number',
  maxPerMonth: 'referral_max_per_month',
};

export const REFERRAL_DEFAULTS: ReferralSettings = {
  programLive: true,
  whoCanEarn: 'PAID_PLAN',
  commissionPct: 20,
  friendDiscountPct: 10,
  holdDays: 7,
  minWithdrawal: 300,
  withdrawalFee: 0,
  payWithinDays: 3,
  payoutMethods: ['BKASH', 'NAGAD', 'ROCKET', 'BANK'],
  blockSelf: true,
  cancelOnRefund: true,
  flagSameNumber: true,
  maxPerMonth: null,
};

const isWhole = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);
const whole = (value: unknown, min: number, max: number, fallback: number): number => (isWhole(value, min, max) ? value : fallback);

// The stored rows (key -> JSON value) read as settings. A missing or broken
// value falls back to its default, so a bad row never breaks the program.
export function parseReferralSettings(byKey: ReadonlyMap<string, unknown>): ReferralSettings {
  const d = REFERRAL_DEFAULTS;
  const k = REFERRAL_SETTING_KEYS;
  const who = byKey.get(k.whoCanEarn);
  const methods = byKey.get(k.payoutMethods);
  const validMethods = Array.isArray(methods) ? methods.filter((m): m is PayoutMethodType => PAYOUT_METHOD_TYPES.includes(m as PayoutMethodType)) : [];
  const max = byKey.get(k.maxPerMonth);
  return {
    programLive: bool(byKey.get(k.programLive), d.programLive),
    whoCanEarn: WHO_CAN_EARN.includes(who as WhoCanEarn) ? (who as WhoCanEarn) : d.whoCanEarn,
    commissionPct: whole(byKey.get(k.commissionPct), 0, 100, d.commissionPct),
    friendDiscountPct: whole(byKey.get(k.friendDiscountPct), 0, 100, d.friendDiscountPct),
    holdDays: whole(byKey.get(k.holdDays), 0, 365, d.holdDays),
    minWithdrawal: whole(byKey.get(k.minWithdrawal), 1, 10_000_000, d.minWithdrawal),
    withdrawalFee: whole(byKey.get(k.withdrawalFee), 0, 10_000_000, d.withdrawalFee),
    payWithinDays: whole(byKey.get(k.payWithinDays), 1, 60, d.payWithinDays),
    payoutMethods: validMethods.length > 0 ? [...new Set(validMethods)] : d.payoutMethods,
    blockSelf: bool(byKey.get(k.blockSelf), d.blockSelf),
    cancelOnRefund: bool(byKey.get(k.cancelOnRefund), d.cancelOnRefund),
    flagSameNumber: bool(byKey.get(k.flagSameNumber), d.flagSameNumber),
    maxPerMonth: isWhole(max, 1, 1_000_000) ? max : null,
  };
}
