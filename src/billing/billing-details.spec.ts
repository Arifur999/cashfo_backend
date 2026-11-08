import { describe, expect, it } from 'vitest';
import { BILLING_NAME_REGEX, billingColumns, billingRecipient, issuedToLine } from './billing-details.js';

const account = { name: 'Shirin Akter', email: 'shirin@example.com', phone: '+8801711000000' };

describe('billingRecipient', () => {
  it("uses the account's own details when none are saved", () => {
    expect(billingRecipient({ ...account, billingName: null, billingPhone: null, billingEmail: null })).toEqual(account);
  });

  it('uses each saved billing detail over the account one', () => {
    const user = { ...account, billingName: 'Akter Traders', billingPhone: '+8801811000000', billingEmail: 'accounts@akter.example' };
    expect(billingRecipient(user)).toEqual({ name: 'Akter Traders', phone: '+8801811000000', email: 'accounts@akter.example' });
    expect(issuedToLine(billingRecipient(user))).toBe('Akter Traders <accounts@akter.example>');
  });
});

describe('billingColumns', () => {
  it("keeps a value equal to the account's as null, so account changes still reach receipts", () => {
    expect(billingColumns(account, { name: 'Shirin Akter', phone: '+8801711000000', email: 'shirin@example.com' })).toEqual({
      billingName: null,
      billingPhone: null,
      billingEmail: null,
    });
  });

  it('stores what differs, and an empty phone or email as null', () => {
    expect(billingColumns(account, { name: 'Akter Traders', phone: null, email: 'accounts@akter.example' })).toEqual({
      billingName: 'Akter Traders',
      billingPhone: null,
      billingEmail: 'accounts@akter.example',
    });
  });
});

describe('BILLING_NAME_REGEX', () => {
  it('takes names in English or Bangla', () => {
    for (const name of ['Shirin Akter', "O'Neil-Rahman Jr.", 'শিরিন আক্তার']) expect(BILLING_NAME_REGEX.test(name)).toBe(true);
  });

  it('refuses digits and symbols', () => {
    for (const name of ['Shirin 2', 'shirin@home', '#1 Shop', ' Shirin']) expect(BILLING_NAME_REGEX.test(name)).toBe(false);
  });
});
