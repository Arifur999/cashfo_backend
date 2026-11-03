import { describe, expect, it } from 'vitest';
import { EMPTY_PAYMENT_ACCOUNTS, isManualWallet, normaliseSubmission, offeredAccounts, parsePaymentAccounts } from './manual-payments.js';

describe('normaliseSubmission', () => {
  it('keeps a wallet number as digits and the TrxID in capitals without spaces', () => {
    expect(normaliseSubmission('BKASH', '+880 1711-482915', ' 9kd7 h2x4lm ')).toEqual({ value: { payerAccount: '01711482915', reference: '9KD7H2X4LM' } });
  });

  it('takes a Rocket number with its check digit', () => {
    expect(normaliseSubmission('ROCKET', '01711-4829155', '4102938475')).toEqual({ value: { payerAccount: '017114829155', reference: '4102938475' } });
  });

  it('refuses a number that is not a Bangladeshi mobile', () => {
    expect(normaliseSubmission('NAGAD', '0171148291', '7HX2K9QA')).toMatchObject({ field: 'payerAccount' });
    expect(normaliseSubmission('BKASH', '01211482915', '9KD7H2X4LM')).toMatchObject({ field: 'payerAccount' });
    expect(normaliseSubmission('BKASH', '017114829155', '9KD7H2X4LM')).toMatchObject({ field: 'payerAccount' });
  });

  it('refuses a TrxID that is too short or has odd characters', () => {
    expect(normaliseSubmission('BKASH', '01711482915', '9KD7H2X')).toMatchObject({ field: 'reference' });
    expect(normaliseSubmission('BKASH', '01711482915', '9KD7<H2X4LM')).toMatchObject({ field: 'reference' });
    expect(normaliseSubmission('BKASH', '01711482915', '--------')).toMatchObject({ field: 'reference' });
    expect(normaliseSubmission('BKASH', '01711482915', 'A'.repeat(41))).toMatchObject({ field: 'reference' });
  });

  it('takes a bank transfer by the account name and a shorter reference', () => {
    expect(normaliseSubmission('BANK', '  Khaled   Mahmud ', 'beftn-2611-0042')).toEqual({
      value: { payerAccount: 'Khaled Mahmud', reference: 'BEFTN-2611-0042' },
    });
    expect(normaliseSubmission('BANK', 'Khaled', 'AB1234')).toMatchObject({ value: { reference: 'AB1234' } });
    expect(normaliseSubmission('BANK', 'Kh', 'AB1234')).toMatchObject({ field: 'payerAccount' });
    expect(normaliseSubmission('BANK', 'Khaled', 'AB123')).toMatchObject({ field: 'reference' });
  });
});

describe('payment accounts', () => {
  it('reads a missing or broken setting as empty', () => {
    expect(parsePaymentAccounts(undefined)).toEqual(EMPTY_PAYMENT_ACCOUNTS);
    expect(parsePaymentAccounts('nonsense')).toEqual(EMPTY_PAYMENT_ACCOUNTS);
    expect(parsePaymentAccounts({ bkash: 1709, bank: 'x' })).toEqual(EMPTY_PAYMENT_ACCOUNTS);
  });

  it('offers only the ways with somewhere to send to', () => {
    const accounts = parsePaymentAccounts({
      bkash: ' 01309000555 ',
      nagad: '',
      bank: { bankName: 'BRAC Bank', accountName: 'Smartly Technologies Ltd', accountNumber: '' },
    });
    expect(offeredAccounts(accounts)).toEqual({ BKASH: '01309000555' });
    const withBank = parsePaymentAccounts({ rocket: '013090005557', bank: { bankName: 'BRAC Bank', accountName: 'Smartly', accountNumber: '1503204155900' } });
    expect(Object.keys(offeredAccounts(withBank))).toEqual(['ROCKET', 'BANK']);
  });

  it('knows the manual wallets', () => {
    expect(isManualWallet('BANK')).toBe(true);
    expect(isManualWallet('CARD')).toBe(false);
  });
});
