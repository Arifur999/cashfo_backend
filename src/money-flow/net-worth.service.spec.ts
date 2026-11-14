import { Prisma } from '@prisma/client';
import { NetWorthService, netOf } from './net-worth.service.js';

const D = (value: number) => new Prisma.Decimal(value);

describe('NetWorthService', () => {
  it('reads wallets, savings, assets and loans as they stood when each day ended', async () => {
    const prisma = {
      account: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'cash', accountSubtype: 'cash', openingBalance: D(1_000), status: 'ACTIVE' },
          { id: 'saving', accountSubtype: 'savings', openingBalance: D(0), status: 'ACTIVE' },
        ]),
      },
      transactionEntry: {
        groupBy: vi
          .fn()
          // 31 Oct: 5,000 in, 2,000 out of cash; 3,000 into savings.
          .mockResolvedValueOnce([
            { accountId: 'cash', entryType: 'DEBIT', _sum: { amount: D(5_000) } },
            { accountId: 'cash', entryType: 'CREDIT', _sum: { amount: D(2_000) } },
            { accountId: 'saving', entryType: 'DEBIT', _sum: { amount: D(3_000) } },
          ])
          // Today: 1,000 more spent.
          .mockResolvedValueOnce([
            { accountId: 'cash', entryType: 'DEBIT', _sum: { amount: D(5_000) } },
            { accountId: 'cash', entryType: 'CREDIT', _sum: { amount: D(3_000) } },
            { accountId: 'saving', entryType: 'DEBIT', _sum: { amount: D(3_000) } },
          ]),
      },
      asset: {
        findMany: vi.fn().mockResolvedValue([
          // Bought in 2025 for 1,00,000; written at 1,10,000 in October; 1,20,000 now.
          { purchaseDate: new Date('2025-01-01T00:00:00Z'), purchasePrice: D(100_000), currentValue: D(120_000), soldAt: null, status: 'ACTIVE', valueHistory: [{ value: D(110_000), recordedAt: new Date('2026-10-10T06:00:00Z') }] },
          // Sold on 3 November.
          { purchaseDate: new Date('2025-06-01T00:00:00Z'), purchasePrice: D(50_000), currentValue: D(50_000), soldAt: new Date('2026-11-03T06:00:00Z'), status: 'SOLD', valueHistory: [] },
        ]),
      },
      investment: {
        findMany: vi.fn().mockResolvedValue([
          // 3,00,000 put in on 15 October, 50,000 taken back on 5 November.
          {
            entries: [
              { type: 'INVEST', amount: D(300_000), date: new Date('2026-10-15T00:00:00Z') },
              { type: 'PROFIT', amount: D(9_000), date: new Date('2026-10-30T00:00:00Z') },
              { type: 'BACK', amount: D(50_000), date: new Date('2026-11-05T00:00:00Z') },
            ],
          },
          // Closed with everything back: no capital left, not counted.
          { entries: [{ type: 'INVEST', amount: D(10_000), date: new Date('2026-01-01T00:00:00Z') }, { type: 'LOSS', amount: D(10_000), date: new Date('2026-02-01T00:00:00Z') }] },
        ]),
      },
    };
    const loans = {
      loanBalancesAt: vi.fn().mockResolvedValue([
        { day: '2026-10-31', pawna: 5_000, dena: 10_000, owesYou: 1, youOwe: 1 },
        { day: '2026-11-07', pawna: 4_000, dena: 10_000, owesYou: 1, youOwe: 1 },
      ]),
    };
    const [before, after] = await new NetWorthService(prisma as never, loans as never).on('b1', ['2026-10-31', '2026-11-07'], '2026-11-07');
    expect(before).toEqual({ day: '2026-10-31', parts: { cash: 4_000, savings: 3_000, assets: 160_000, investments: 300_000, pawna: 5_000, dena: 10_000 },
      counts: { accounts: 1, assets: 2, investments: 1, pawna: 1, dena: 1 },
    });
    expect(after.parts).toEqual({ cash: 3_000, savings: 3_000, assets: 120_000, investments: 250_000, pawna: 4_000, dena: 10_000 });
    expect(netOf(after) - netOf(before)).toBe(-92_000);
  });
});
