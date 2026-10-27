import { payoutChecks } from './payout-checks.js';
import { destinationLabel, normaliseMethod, type MethodSnapshot } from './payout-methods.js';

describe('normaliseMethod', () => {
  it('keeps a wallet number as digits and drops the bank fields', () => {
    expect(normaliseMethod({ type: 'BKASH', accountName: ' Khaled  Mahmud ', walletNumber: '+880 1711-482915', bankName: 'BRAC' })).toEqual({
      value: {
        type: 'BKASH',
        accountName: 'Khaled Mahmud',
        walletNumber: '01711482915',
        bankName: null,
        branch: null,
        bankAccountType: null,
        accountNumber: null,
        routingNumber: null,
      },
    });
  });

  it('wants the right number for the service', () => {
    expect(normaliseMethod({ type: 'NAGAD', accountName: 'Nasrin', walletNumber: '1819552310' })).toHaveProperty('problem');
    expect(normaliseMethod({ type: 'ROCKET', accountName: 'Shafiq', walletNumber: '01556-7812043' })).toHaveProperty('value.walletNumber', '015567812043');
    expect(normaliseMethod({ type: 'BKASH', accountName: 'Shafiq', walletNumber: '01556-7812043' })).toHaveProperty('problem');
  });

  it('needs the bank, the account type, the number and a 9-digit routing number', () => {
    const bank = {
      type: 'BANK' as const,
      accountName: 'Khaled Mahmud',
      bankName: 'BRAC Bank',
      branch: 'Gulshan',
      bankAccountType: 'SAVINGS' as const,
      accountNumber: '1503 2041 2201',
      routingNumber: '060261726',
    };
    expect(normaliseMethod(bank)).toEqual({
      value: { ...bank, walletNumber: null, accountNumber: '150320412201' },
    });
    expect(normaliseMethod({ ...bank, routingNumber: '06026172' })).toEqual({ problem: 'The routing number has 9 digits' });
    expect(normaliseMethod({ ...bank, bankAccountType: null })).toHaveProperty('problem');
    expect(normaliseMethod({ ...bank, bankName: '' })).toHaveProperty('problem');
    expect(normaliseMethod({ ...bank, accountName: ' ' })).toEqual({ problem: 'Enter the name on the account' });
  });

  it('names the destination for an email without the full number', () => {
    expect(destinationLabel({ type: 'BKASH', walletNumber: '01711482915' } as MethodSnapshot)).toBe('bKash 01711-•••915');
    expect(destinationLabel({ type: 'BANK', bankName: 'BRAC Bank', accountNumber: '150320412201' } as MethodSnapshot)).toBe('BRAC Bank •••• 2201');
  });
});

describe('payoutChecks', () => {
  const nagad: MethodSnapshot = {
    type: 'NAGAD',
    accountName: 'Nasrin Akter',
    walletNumber: '01819552310',
    bankName: null,
    branch: null,
    bankAccountType: null,
    accountNumber: null,
    routingNumber: null,
  };
  const base = {
    method: nagad,
    user: { name: 'Nasrin Akter', phone: null },
    codeConfirmedAt: new Date('2026-09-30T10:05:00.000Z'),
    backing: [{ refunded: false }],
    friendPayerAccounts: ['01675904412'],
    flagSameNumber: true,
  };
  const okOf = (input: Parameters<typeof payoutChecks>[0]) => Object.fromEntries(payoutChecks(input).map((c) => [c.key, c.ok]));

  it('passes a clean request', () => {
    expect(okOf(base)).toEqual({
      NAME_MATCHES: true,
      CODE_CONFIRMED: true,
      NO_REFUNDS: true,
      FRIEND_PAID_FROM_THIS_NUMBER: true,
      WRONG_NUMBER_FOR_METHOD: true,
    });
  });

  it('warns about another name, a refund, and a friend paying from the payout number or the member’s phone', () => {
    expect(okOf({ ...base, user: { name: 'Rumana Khan', phone: null } }).NAME_MATCHES).toBe(false);
    expect(okOf({ ...base, backing: [{ refunded: true }] }).NO_REFUNDS).toBe(false);
    expect(okOf({ ...base, friendPayerAccounts: ['+880 1819-552310'] }).FRIEND_PAID_FROM_THIS_NUMBER).toBe(false);
    expect(okOf({ ...base, user: { name: 'Nasrin Akter', phone: '01675904412' } }).FRIEND_PAID_FROM_THIS_NUMBER).toBe(false);
  });

  it('leaves the same-number check out when it is switched off, and checks no number for a bank', () => {
    expect(okOf({ ...base, flagSameNumber: false })).not.toHaveProperty('FRIEND_PAID_FROM_THIS_NUMBER');
    expect(okOf({ ...base, method: { ...nagad, type: 'BANK', walletNumber: null, accountNumber: '150320412201' } })).not.toHaveProperty(
      'WRONG_NUMBER_FOR_METHOD',
    );
  });

  it('flags a stored number that does not fit the service', () => {
    expect(okOf({ ...base, method: { ...nagad, walletNumber: '0167590441' } }).WRONG_NUMBER_FOR_METHOD).toBe(false);
  });
});
