import {
  addWorkingDays,
  canonicalEmail,
  commissionPaisa,
  isoWeekKey,
  looksLikeSamePerson,
  maskEmail,
  maskPhone,
  namesMatch,
  normaliseMobile,
  samePhone,
  walletNumberFits,
} from './referral-money.js';
import { balancesOf } from './referral-ledger.js';

describe('commissionPaisa', () => {
  it('takes the rate of what the friend paid, rounded down to the paisa', () => {
    expect(commissionPaisa(270_000, 20)).toBe(54_000); // ৳ 2,700 -> ৳ 540
    expect(commissionPaisa(27_000, 20)).toBe(5_400); // ৳ 270 -> ৳ 54
    expect(commissionPaisa(72_000, 20)).toBe(14_400); // ৳ 720 -> ৳ 144
    expect(commissionPaisa(171_900, 20)).toBe(34_380); // ৳ 1,719 -> ৳ 343.80
    expect(commissionPaisa(29_900, 20)).toBe(5_980); // ৳ 299 -> ৳ 59.80
    expect(commissionPaisa(29_990, 12.5)).toBe(3_748); // ৳ 299.90 at 12.5 % -> ৳ 37.4875 -> ৳ 37.48
  });

  it('is nothing for no payment or a zero rate', () => {
    expect(commissionPaisa(0, 20)).toBe(0);
    expect(commissionPaisa(270_000, 0)).toBe(0);
  });
});

describe('balancesOf', () => {
  it('sums the lines by where they are; lifetime leaves out what was taken back', () => {
    const next = new Date('2026-11-05T06:00:00.000Z');
    const b = balancesOf(
      [
        { status: 'AVAILABLE', paisa: 54_000 },
        { status: 'ON_HOLD', paisa: 34_380 },
        { status: 'IN_WITHDRAWAL', paisa: 10_000 },
        { status: 'UNDER_CHECK', paisa: 3_580 },
        { status: 'PAID_OUT', paisa: 100_000 },
        { status: 'REVERSED', paisa: 3_580 },
        { status: 'CANCELLED', paisa: 9_999 },
      ],
      next,
    );
    expect(b).toEqual({
      availablePaisa: 54_000,
      onHoldPaisa: 34_380,
      onHoldNextAt: next,
      inWithdrawalPaisa: 10_000,
      underCheckPaisa: 3_580,
      paidOutPaisa: 100_000,
      reversedPaisa: 3_580,
      lifetimePaisa: 201_960,
    });
  });
});

describe('addWorkingDays', () => {
  it('skips Friday and Saturday', () => {
    // Thursday 1 Oct 2026 + 3 working days -> Tuesday 6 Oct.
    expect(addWorkingDays(new Date('2026-10-01T05:20:00.000Z'), 3)).toBe('2026-10-06');
    // Sunday + 3 -> Wednesday.
    expect(addWorkingDays(new Date('2026-10-04T05:00:00.000Z'), 3)).toBe('2026-10-07');
    // Friday + 1 -> Sunday.
    expect(addWorkingDays(new Date('2026-10-02T05:00:00.000Z'), 1)).toBe('2026-10-04');
  });

  it('counts from the Dhaka date', () => {
    // 20:00 UTC Wednesday is already Thursday 02:00 in Dhaka.
    expect(addWorkingDays(new Date('2026-09-30T20:00:00.000Z'), 3)).toBe('2026-10-06');
  });
});

describe('isoWeekKey', () => {
  it('names the ISO week on the Dhaka calendar', () => {
    expect(isoWeekKey(new Date('2026-10-27T06:00:00.000Z'))).toBe('2026-W44');
    expect(isoWeekKey(new Date('2027-01-01T06:00:00.000Z'))).toBe('2026-W53');
  });
});

describe('numbers and names', () => {
  it('reads a mobile number as 01XXXXXXXXX', () => {
    expect(normaliseMobile('01711-482915')).toBe('01711482915');
    expect(normaliseMobile('+880 1711 482915')).toBe('01711482915');
  });

  it('checks a wallet number against its service', () => {
    expect(walletNumberFits('BKASH', '01711482915')).toBe(true);
    expect(walletNumberFits('NAGAD', '0171148291')).toBe(false);
    expect(walletNumberFits('NAGAD', '01211482915')).toBe(false);
    expect(walletNumberFits('ROCKET', '015567812043')).toBe(true);
    expect(walletNumberFits('ROCKET', '01556781204')).toBe(true);
    expect(walletNumberFits('BKASH', '015567812043')).toBe(false);
    expect(walletNumberFits('BANK', null)).toBe(true);
  });

  it('matches phones however they are written', () => {
    expect(samePhone('01711-482915', '+8801711482915')).toBe(true);
    expect(samePhone('015567812043', '01556781204')).toBe(true);
    expect(samePhone('01711482915', '01711482916')).toBe(false);
    expect(samePhone(null, '01711482915')).toBe(false);
  });

  it('spots the referrer signing up again', () => {
    expect(canonicalEmail('K.Mahmud+test@GMAIL.com')).toBe('kmahmud@gmail.com');
    expect(looksLikeSamePerson({ email: 'kmahmud@gmail.com', phone: null }, { email: 'k.mahmud+2@googlemail.com', phone: null })).toBe(true);
    expect(looksLikeSamePerson({ email: 'a@x.com', phone: '01711482915' }, { email: 'b@y.com', phone: '+880 1711-482915' })).toBe(true);
    expect(looksLikeSamePerson({ email: 'a.b@x.com', phone: '01711482915' }, { email: 'ab@x.com', phone: '01819552310' })).toBe(false);
  });

  it('matches names loosely', () => {
    expect(namesMatch('Md. Khaled  Mahmud', 'md khaled mahmud')).toBe(true);
    expect(namesMatch('Khaled Mahmud', 'Khaled Hasan')).toBe(false);
    expect(namesMatch('', 'Khaled')).toBe(false);
  });

  it('masks where a code went', () => {
    expect(maskEmail('khaled@gmail.com')).toBe('k***@gmail.com');
    expect(maskPhone('01711482915')).toBe('01711-•••915');
  });
});
