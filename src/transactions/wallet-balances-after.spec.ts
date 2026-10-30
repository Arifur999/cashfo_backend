import { TransactionsService } from './transactions.service.js';

const at = (day: string, minute = 0) => ({ transactionDate: new Date(`${day}T00:00:00.000Z`), createdAt: new Date(Date.UTC(2026, 9, 1, 0, minute)) });
const leg = (accountId: string, entryType: 'DEBIT' | 'CREDIT') => ({ accountId, entryType, account: { accountType: 'ASSET' as const } });

// Cash opened at 1,000. Oct 1: 500 Bank -> Cash (voided on Oct 20, its
// reversal dated then). Oct 10: 200 Cash -> Bank. Oct 15: 300 Bank -> Cash.
const entries = [
  { accountId: 'cash', entryType: 'DEBIT', amount: 500, transaction: at('2026-10-01', 1) },
  { accountId: 'cash', entryType: 'CREDIT', amount: 200, transaction: at('2026-10-10', 2) },
  { accountId: 'cash', entryType: 'DEBIT', amount: 300, transaction: at('2026-10-15', 3) },
  { accountId: 'cash', entryType: 'CREDIT', amount: 500, transaction: at('2026-10-20', 4) },
  { accountId: 'bank', entryType: 'CREDIT', amount: 500, transaction: at('2026-10-01', 1) },
  { accountId: 'bank', entryType: 'DEBIT', amount: 200, transaction: at('2026-10-10', 2) },
  { accountId: 'bank', entryType: 'CREDIT', amount: 300, transaction: at('2026-10-15', 3) },
];

function setup() {
  const prisma = {
    account: { findMany: vi.fn(async () => [{ id: 'cash', openingBalance: 1000 }, { id: 'bank', openingBalance: 5000 }]) },
    transactionEntry: {
      findMany: vi.fn(async ({ where }: { where: { accountId: { in: string[] }; transaction: { transactionDate: { lte: Date } } } }) =>
        entries.filter((entry) => where.accountId.in.includes(entry.accountId) && entry.transaction.transactionDate <= where.transaction.transactionDate.lte),
      ),
    },
  };
  const service = new TransactionsService(prisma as never, {} as never);
  return { service, prisma };
}

const rows = [
  { id: 'oct15', ...at('2026-10-15', 3), entries: [leg('cash', 'DEBIT'), leg('bank', 'CREDIT')] },
  { id: 'oct10', ...at('2026-10-10', 2), entries: [leg('bank', 'DEBIT'), leg('cash', 'CREDIT')] },
  { id: 'oct01', ...at('2026-10-01', 1), entries: [leg('cash', 'DEBIT'), leg('bank', 'CREDIT')] },
];

describe('the transfer list balance after each row', () => {
  it('reads the receiving wallet as its ledger runs it, a voided row still counted until its reversal', async () => {
    const { service, prisma } = setup();
    const balances = await (service as never as { walletBalancesAfter: (r: typeof rows, a?: string) => Promise<Map<string, string>> }).walletBalancesAfter(rows);
    expect(Object.fromEntries(balances)).toEqual({ oct01: '1500.00', oct10: '4700.00', oct15: '1600.00' });
    // Nothing after the newest row is read.
    expect(prisma.transactionEntry.findMany.mock.calls[0][0].where.transaction.transactionDate.lte).toEqual(new Date('2026-10-15T00:00:00.000Z'));
  });

  it('follows the filtered wallet on every row, in or out', async () => {
    const { service } = setup();
    const balances = await (service as never as { walletBalancesAfter: (r: typeof rows, a?: string) => Promise<Map<string, string>> }).walletBalancesAfter(rows, 'cash');
    expect(Object.fromEntries(balances)).toEqual({ oct01: '1500.00', oct10: '1300.00', oct15: '1600.00' });
  });
});
