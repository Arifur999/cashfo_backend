import { parseReferralSettings, REFERRAL_DEFAULTS } from './referral-settings.js';

describe('parseReferralSettings', () => {
  it('uses the defaults when nothing is stored', () => {
    expect(parseReferralSettings(new Map())).toEqual(REFERRAL_DEFAULTS);
    expect(REFERRAL_DEFAULTS).toMatchObject({
      commissionPct: 20,
      friendDiscountPct: 10,
      holdDays: 7,
      minWithdrawal: 300,
      withdrawalFee: 0,
      payWithinDays: 3,
      maxPerMonth: null,
    });
  });

  it('reads stored values and ignores broken ones', () => {
    const settings = parseReferralSettings(
      new Map<string, unknown>([
        ['referral_program_live', false],
        ['referral_who_can_earn', 'EVERYONE'],
        ['referral_commission_pct', 25],
        ['referral_friend_discount_pct', 'ten'],
        ['referral_hold_days', -1],
        ['referral_min_withdrawal', 300],
        ['referral_payout_methods', ['BKASH', 'PAYPAL', 'BKASH']],
        ['referral_max_per_month', 50],
      ]),
    );
    expect(settings).toMatchObject({
      programLive: false,
      whoCanEarn: 'EVERYONE',
      commissionPct: 25,
      friendDiscountPct: 10,
      holdDays: 7,
      minWithdrawal: 300,
      payoutMethods: ['BKASH'],
      maxPerMonth: 50,
    });
  });

  it('falls back to every method when none valid is stored, and reads JSON null as no limit', () => {
    const settings = parseReferralSettings(
      new Map<string, unknown>([
        ['referral_payout_methods', []],
        ['referral_max_per_month', null],
      ]),
    );
    expect(settings.payoutMethods).toEqual(['BKASH', 'NAGAD', 'ROCKET', 'BANK']);
    expect(settings.maxPerMonth).toBeNull();
  });
});
