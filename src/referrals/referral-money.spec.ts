import {
  addWorkingDays,
  allocateFifo,
  canonicalEmail,
  commissionPaisa,
  isoWeekKey,
  legacyStatusOf,
  looksLikeSamePerson,
  maskEmail,
  maskPhone,
  namesMatch,
  normaliseMobile,
  projectBacking,
  referralBalances,
  samePhone,
  walletNumberFits,
  type CommissionEntry,
} from './referral-money.js';

const day = (iso: string) => new Date(`${iso}T06:00:00.000Z`);
let n = 0;
const entry = (over: Partial<CommissionEntry>): CommissionEntry => ({
  id: `r-${++n}`,
  status: 'AVAILABLE',
  commissionPaisa: 54_000,
  paidOutPaisa: 0,
  availableAt: day('2026-09-12'),
  createdAt: day('2026-09-02'),
  ...over,
});

describe('commissionPaisa', () => {
  it('takes the rate of what the friend paid, rounded down to whole taka', () => {
    expect(commissionPaisa(270_000, 20)).toBe(54_000); // ৳ 2,700 -> ৳ 540
    expect(commissionPaisa(27_000, 20)).toBe(5_400); // ৳ 270 -> ৳ 54
    expect(commissionPaisa(72_000, 20)).toBe(14_400); // ৳ 720 -> ৳ 144
    expect(commissionPaisa(29_900, 20)).toBe(5_900); // ৳ 299 -> ৳ 59.80 -> ৳ 59
    expect(commissionPaisa(29_990, 12.5)).toBe(3_700); // ৳ 299.90 at 12.5 % -> ৳ 37.48 -> ৳ 37
  });

  it('is nothing for no payment or a zero rate', () => {
    expect(commissionPaisa(0, 20)).toBe(0);
    expect(commissionPaisa(270_000, 0)).toBe(0);
  });
});

describe('referralBalances', () => {
  // Khaled on the boards: ৳ 1,224 available + ৳ 594 paid out = ৳ 1,818
  // earned, and ৳ 540 pending until 5 Oct.
  const khaled = [
    entry({ commissionPaisa: 54_000 }),
    entry({ commissionPaisa: 14_400 }),
    entry({ commissionPaisa: 54_000 }),
    entry({ status: 'PAID_OUT', commissionPaisa: 54_000, paidOutPaisa: 54_000 }),
    entry({ status: 'PAID_OUT', commissionPaisa: 5_400, paidOutPaisa: 5_400 }),
    entry({ status: 'PENDING', commissionPaisa: 54_000, availableAt: day('2026-10-05') }),
    entry({ status: 'CANCELLED', commissionPaisa: 5_400 }),
    entry({ status: 'JOINED', commissionPaisa: 0 }),
  ];

  it('adds up available, pending, paid out and earned', () => {
    expect(referralBalances(khaled, [])).toEqual({
      availablePaisa: 122_400,
      reservedPaisa: 0,
      pendingPaisa: 54_000,
      pendingNextAt: day('2026-10-05'),
      paidOutPaisa: 59_400,
      totalEarnedPaisa: 181_800,
    });
  });

  it('sets aside what open requests ask for, and gives it back when they are rejected or cancelled', () => {
    const open = referralBalances(khaled, [{ status: 'REQUESTED', amountPaisa: 100_000 }]);
    expect(open.availablePaisa).toBe(22_400); // ৳ 224 left after the ৳ 1,000 request
    expect(open.reservedPaisa).toBe(100_000);
    expect(open.totalEarnedPaisa).toBe(181_800);

    expect(referralBalances(khaled, [{ status: 'APPROVED', amountPaisa: 100_000 }]).availablePaisa).toBe(22_400);
    for (const status of ['REJECTED', 'CANCELLED', 'PAID'] as const) {
      expect(referralBalances(khaled, [{ status, amountPaisa: 100_000 }]).availablePaisa).toBe(122_400);
    }
  });

  it('counts an available commission that is partly paid out by what is left', () => {
    const balances = referralBalances([entry({ commissionPaisa: 54_000, paidOutPaisa: 40_000 })], []);
    expect(balances.availablePaisa).toBe(14_000);
    expect(balances.paidOutPaisa).toBe(40_000);
  });
});

describe('allocateFifo', () => {
  const oldest = entry({ id: 'old', commissionPaisa: 54_000, availableAt: day('2026-09-12') });
  const middle = entry({ id: 'mid', commissionPaisa: 14_400, availableAt: day('2026-09-22') });
  const newest = entry({ id: 'new', commissionPaisa: 54_000, availableAt: day('2026-09-26') });

  it('takes the oldest available commissions first and says which it closes', () => {
    expect(allocateFifo([newest, oldest, middle], 100_000)).toEqual([
      { referralId: 'old', paisa: 54_000, closes: true },
      { referralId: 'mid', paisa: 14_400, closes: true },
      { referralId: 'new', paisa: 31_600, closes: false },
    ]);
  });

  it('starts a partly paid commission from what is left of it', () => {
    expect(allocateFifo([{ ...oldest, paidOutPaisa: 50_000 }, middle], 10_000)).toEqual([
      { referralId: 'old', paisa: 4_000, closes: true },
      { referralId: 'mid', paisa: 6_000, closes: false },
    ]);
  });

  it('refuses more than there is, and skips anything not available', () => {
    expect(allocateFifo([oldest, { ...middle, status: 'PENDING' }], 60_000)).toBeNull();
  });
});

describe('projectBacking', () => {
  const a = entry({ id: 'a', commissionPaisa: 54_000, availableAt: day('2026-09-12') });
  const b = entry({ id: 'b', commissionPaisa: 54_000, availableAt: day('2026-09-20') });

  it('lets earlier requests take the oldest commissions first', () => {
    const open = [
      { id: 'wd-2', number: 1049, amountPaisa: 50_000 },
      { id: 'wd-1', number: 1048, amountPaisa: 60_000 },
    ];
    expect(projectBacking([b, a], open, 'wd-1')).toEqual([
      { referralId: 'a', paisa: 54_000, closes: true },
      { referralId: 'b', paisa: 6_000, closes: false },
    ]);
    expect(projectBacking([b, a], open, 'wd-2')).toEqual([{ referralId: 'b', paisa: 48_000, closes: true }]);
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

  it('gives old apps the statuses they know', () => {
    expect(legacyStatusOf('JOINED')).toBe('PENDING');
    expect(legacyStatusOf('PENDING')).toBe('PENDING');
    expect(legacyStatusOf('AVAILABLE')).toBe('CONFIRMED');
    expect(legacyStatusOf('PAID_OUT')).toBe('WITHDRAWN');
    expect(legacyStatusOf('CANCELLED')).toBe('CANCELLED');
  });
});
