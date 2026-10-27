import { dateLabel, displayPaymentId, fillTemplate, formatTaka, localeOf, methodName } from './billing-text.js';

describe('formatTaka', () => {
  it('groups in lakh and crore, with the paisa only when there are some', () => {
    expect(formatTaka(29900)).toBe('299');
    expect(formatTaka(125000000)).toBe('12,50,000');
    expect(formatTaka(269910)).toBe('2,699.10');
    expect(formatTaka(1234567890)).toBe('1,23,45,678.90');
  });

  it('writes Bangla digits for Bangla', () => {
    expect(formatTaka(129900, 'bn')).toBe('১,২৯৯');
  });
});

describe('the checkout instructions', () => {
  it('fills the amount, reference and method, and leaves an unknown word alone', () => {
    const text = fillTemplate('Send ৳ {amount} by {method} with {reference}. {other}', {
      amount: '299',
      method: methodName('BKASH', 'en'),
      reference: displayPaymentId('3f2a1c9b-0000'),
    });
    expect(text).toBe('Send ৳ 299 by bKash with PAY-3F2A1C9B. {other}');
  });

  it('names the method in Bangla', () => {
    expect(methodName('NAGAD', 'bn')).toBe('নগদ');
  });
});

describe('dateLabel', () => {
  it('prints the Dhaka date, in English or Bangla', () => {
    // 20:00 UTC on the 27th is already the 28th in Dhaka.
    expect(dateLabel(new Date('2026-10-27T20:00:00.000Z'), 'en')).toBe('28 Oct 2026');
    expect(dateLabel(new Date('2026-10-27T06:00:00.000Z'), 'bn')).toBe('২৭ অক্টোবর ২০২৬');
  });
});

describe('localeOf', () => {
  it('reads the account language', () => {
    expect(localeOf('BN')).toBe('bn');
    expect(localeOf('EN')).toBe('en');
    expect(localeOf(null)).toBe('en');
  });
});
