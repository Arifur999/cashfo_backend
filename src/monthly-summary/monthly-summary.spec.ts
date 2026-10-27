import {
  dueSummaryMonth,
  formattedFigures,
  hasActivity,
  monthBounds,
  monthEndInstant,
  monthLabel,
  previousMonthKey,
  summaryFigures,
} from './monthly-summary-rules.js';
import { MonthlySummaryService } from './monthly-summary.service.js';

describe('dueSummaryMonth', () => {
  it('is last month from 08:00 Dhaka on the 1st through the 3rd', () => {
    // 1 Nov 2026 07:59 Dhaka = 01:59 UTC: not yet.
    expect(dueSummaryMonth(new Date('2026-11-01T01:59:00Z'))).toBeNull();
    expect(dueSummaryMonth(new Date('2026-11-01T02:00:00Z'))).toBe('2026-10');
    expect(dueSummaryMonth(new Date('2026-10-31T20:00:00Z'))).toBeNull();
    expect(dueSummaryMonth(new Date('2026-11-02T20:00:00Z'))).toBe('2026-10');
    // 4 Nov in Dhaka: too late.
    expect(dueSummaryMonth(new Date('2026-11-03T18:00:00Z'))).toBeNull();
  });

  it('rolls over the year', () => {
    expect(previousMonthKey(2027, 1)).toBe('2026-12');
    expect(dueSummaryMonth(new Date('2027-01-01T06:00:00Z'))).toBe('2026-12');
  });
});

describe('month helpers', () => {
  it('bounds a month at UTC midnights and ends it at Dhaka midnight', () => {
    expect(monthBounds('2026-12')).toEqual({ start: new Date('2026-12-01T00:00:00Z'), end: new Date('2027-01-01T00:00:00Z') });
    expect(monthEndInstant('2026-10')).toEqual(new Date('2026-10-31T18:00:00Z'));
  });

  it('names the month in both languages', () => {
    expect(monthLabel('2026-10', 'en')).toBe('October 2026');
    expect(monthLabel('2026-10', 'bn')).toBe('অক্টোবর ২০২৬');
  });
});

describe('summaryFigures', () => {
  const figures = summaryFigures(
    5_000_000,
    [
      { name: 'Food', paisa: 1_200_000 },
      { name: 'Rent', paisa: 2_500_000 },
      { name: 'Transport', paisa: 300_000 },
      { name: 'Bills', paisa: 450_050 },
    ],
    500_000,
  );

  it('totals the month and keeps the three largest expenses', () => {
    expect(figures).toMatchObject({ incomePaisa: 5_000_000, expensesPaisa: 4_450_050, netPaisa: 549_950, savedPaisa: 500_000 });
    expect(figures.topExpenses.map((row) => row.name)).toEqual(['Rent', 'Food', 'Bills']);
  });

  it('formats amounts the lakh way, net without its sign', () => {
    expect(formattedFigures(figures, 'en')).toMatchObject({ income: '50,000', expenses: '44,500.50', net: '5,499.50', netNegative: false, saved: '5,000' });
    const overspent = formattedFigures(summaryFigures(100_000, [{ name: 'Food', paisa: 250_000 }], 0), 'bn', () => 'খাবার');
    expect(overspent).toMatchObject({ net: '১,৫০০', netNegative: true, topExpenses: [{ name: 'খাবার', amount: '২,৫০০' }] });
  });

  it('calls an empty month empty', () => {
    expect(hasActivity(summaryFigures(0, [], 0))).toBe(false);
    expect(hasActivity(figures)).toBe(true);
  });
});

describe('MonthlySummaryService.run', () => {
  const due = new Date('2026-11-01T03:00:00Z');
  const setup = ({ configured = true, claim = 1, workspace = { id: 'b1', name: 'Personal' } as { id: string; name: string } | null } = {}) => {
    const prisma = {
      user: {
        findMany: vi.fn().mockResolvedValue([{ id: 'u1', name: 'Nadia', email: 'nadia@example.com', preferredLanguage: 'EN' }]),
        updateMany: vi.fn().mockResolvedValue({ count: claim }),
      },
      business: { findFirst: vi.fn().mockResolvedValue(workspace) },
      transactionEntry: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: '1000.00' } }),
        groupBy: vi.fn().mockResolvedValue([{ categoryId: 'Food', _sum: { amount: '400.00' } }]),
      },
      savingsGoalEntry: { aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null } }) },
      defaultCategory: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const mail = { configured, sendMonthlySummaryEmail: vi.fn() };
    const config = { get: vi.fn(() => 'https://app.example') };
    return { service: new MonthlySummaryService(prisma as never, config as never, mail as never), prisma, mail };
  };

  it('claims each person for the month, then sends', async () => {
    const { service, prisma, mail } = setup();
    expect(await service.run(due)).toEqual({ month: '2026-10', sent: 1 });
    expect(prisma.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { monthlySummarySentFor: '2026-10' } }));
    expect(mail.sendMonthlySummaryEmail).toHaveBeenCalledWith(
      'nadia@example.com',
      'en',
      expect.objectContaining({ month: 'October 2026', income: '1,000', expenses: '400', net: '600', topExpenses: [{ name: 'Food', amount: '400' }] }),
    );
  });

  it('claims nothing while email is not set up, or outside the sending days', async () => {
    const off = setup({ configured: false });
    expect(await off.service.run(due)).toEqual({ month: '2026-10', sent: 0 });
    expect(off.prisma.user.findMany).not.toHaveBeenCalled();
    const late = setup();
    expect(await late.service.run(new Date('2026-11-10T03:00:00Z'))).toEqual({ month: null, sent: 0 });
    expect(late.prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('skips a person another run claimed, or one with no workspace', async () => {
    const lost = setup({ claim: 0 });
    await lost.service.run(due);
    expect(lost.mail.sendMonthlySummaryEmail).not.toHaveBeenCalled();
    const none = setup({ workspace: null });
    expect(await none.service.run(due)).toEqual({ month: '2026-10', sent: 0 });
  });
});
