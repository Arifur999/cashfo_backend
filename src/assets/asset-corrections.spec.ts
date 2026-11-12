import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ASSET_DELETED_REASON, AssetsService } from './assets.service.js';

const day = (date: string) => new Date(`${date}T00:00:00.000Z`);

const baseAsset = {
  id: 'asset-1',
  businessId: 'biz-1',
  name: 'Work laptop',
  category: 'Electronics',
  status: 'ACTIVE',
  purchaseDate: day('2024-08-20'),
  purchasePrice: new Prisma.Decimal(70000),
  currentValue: new Prisma.Decimal(50000),
  purchaseAccountId: 'bkash',
  purchaseTransactionId: 't-buy',
  soldAt: null as Date | null,
  soldPrice: null as Prisma.Decimal | null,
  soldAccountId: null as string | null,
  soldTransactionId: null as string | null,
  soldNote: null as string | null,
  notes: 'For office work',
  metal: null,
  weightVori: null,
  createdAt: day('2024-08-20'),
  updatedAt: day('2026-08-20'),
};

const wallet = (id: string, balance: number) => ({
  id,
  businessId: 'biz-1',
  name: id,
  accountType: 'ASSET',
  accountSubtype: 'mfs',
  isSystemAccount: true,
  currentBalance: new Prisma.Decimal(balance),
});

// A service over an in-memory workspace: wallets give back what a void
// returns, so balance checks after a void read the new balance.
const setup = (asset = { ...baseAsset }, balances: Record<string, number> = { bkash: 2530, bank: 305650, cash: -67000 }) => {
  const history = [
    { id: 'v-buy', assetId: 'asset-1', recordedAt: asset.purchaseDate, note: 'Initial purchase value', value: asset.purchasePrice },
    { id: 'v-1', assetId: 'asset-1', recordedAt: day('2025-06-01'), note: null, value: new Prisma.Decimal(60000) },
  ];
  const postings: Record<string, { status: string; voidedReason: string | null; amount: number; accountId: string; sign: number }> = {
    't-buy': { status: 'POSTED', voidedReason: null, amount: 70000, accountId: asset.purchaseAccountId, sign: -1 },
  };
  if (asset.soldTransactionId && asset.soldAccountId && asset.soldPrice) {
    postings[asset.soldTransactionId] = { status: 'POSTED', voidedReason: null, amount: Number(asset.soldPrice), accountId: asset.soldAccountId, sign: 1 };
  }
  let row: typeof asset | null = asset;
  let deletion: { assetId: string; businessId: string; deletedBy: string; deletedAt: Date; snapshot: unknown } | null = null;
  const prisma = {
    asset: {
      findUnique: vi.fn(() => Promise.resolve(row)),
      findUniqueOrThrow: vi.fn(() => Promise.resolve({ ...row, valueHistory: history })),
      update: vi.fn(({ data }: { data: object }) => {
        row = { ...row!, ...data };
        return Promise.resolve({ ...row, valueHistory: history });
      }),
      delete: vi.fn(() => {
        row = null;
        return Promise.resolve({});
      }),
      create: vi.fn(({ data }: { data: typeof asset }) => {
        row = data;
        return Promise.resolve(data);
      }),
    },
    assetValueHistory: {
      findMany: vi.fn(() => Promise.resolve(history)),
      findFirst: vi.fn(() => Promise.resolve([...history].sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime())[0])),
      update: vi.fn(() => Promise.resolve({})),
      create: vi.fn(() => Promise.resolve({})),
      deleteMany: vi.fn(() => Promise.resolve({ count: history.length })),
      createMany: vi.fn(() => Promise.resolve({ count: history.length })),
    },
    account: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) => Promise.resolve(where.id in balances ? wallet(where.id, balances[where.id]) : null)),
      findFirst: vi.fn(() => Promise.resolve({ id: 'fixed' })),
    },
    transaction: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) => Promise.resolve(postings[where.id] ?? null)),
    },
    assetDeletion: {
      upsert: vi.fn(({ create }: { create: NonNullable<typeof deletion> }) => {
        deletion = { ...create, deletedAt: new Date() };
        return Promise.resolve(deletion);
      }),
      findUnique: vi.fn(() => Promise.resolve(deletion)),
      deleteMany: vi.fn(() => Promise.resolve({ count: deletion ? 1 : 0 })),
    },
  };
  let next = 0;
  const transactions = {
    withLocks: vi.fn((_keys: string[], run: (tx: unknown) => unknown) => run(prisma)),
    createTransaction: vi.fn((_biz: string, dto: { entries: { accountId: string; entryType: string; amount: number }[] }) => {
      for (const entry of dto.entries) if (entry.accountId in balances) balances[entry.accountId] += entry.entryType === 'DEBIT' ? entry.amount : -entry.amount;
      next += 1;
      return Promise.resolve({ id: `t-new-${next}` });
    }),
    voidTransaction: vi.fn((_biz: string, id: string, reason: string) => {
      const posting = postings[id];
      posting.status = 'VOIDED';
      posting.voidedReason = reason;
      balances[posting.accountId] -= posting.sign * posting.amount;
      return Promise.resolve({});
    }),
    reinstateVoided: vi.fn((_tx: unknown, _biz: string, id: string, reason: string) => {
      const posting = postings[id];
      if (posting.status !== 'VOIDED' || posting.voidedReason !== reason) return Promise.resolve(false);
      posting.status = 'POSTED';
      balances[posting.accountId] += posting.sign * posting.amount;
      return Promise.resolve(true);
    }),
  };
  const service = new AssetsService(prisma as never, transactions as never);
  return { service, prisma, transactions, balances, postings, getDeletion: () => deletion, getRow: () => row };
};

describe('AssetsService corrections', () => {
  it('reposts a purchase whose price changed, from the money the void gave back', async () => {
    const { service, transactions, balances, getRow } = setup();
    await service.update('biz-1', 'asset-1', { purchasePrice: 72000 }, 'user-1');
    expect(transactions.voidTransaction).toHaveBeenCalledWith('biz-1', 't-buy', 'Purchase corrected: Work laptop', 'user-1', expect.anything());
    expect(balances.bkash).toBe(2530 + 70000 - 72000);
    expect(getRow()).toMatchObject({ purchaseTransactionId: 't-new-1', purchaseAccountId: 'bkash' });
    expect(Number(getRow()!.purchasePrice)).toBe(72000);
  });

  it('turns a paid purchase into one already owned: the money goes back and nothing is posted', async () => {
    const { service, transactions, balances, prisma, getRow } = setup();
    await service.update('biz-1', 'asset-1', { purchaseAccountId: null }, 'user-1');
    expect(transactions.createTransaction).not.toHaveBeenCalled();
    expect(balances.bkash).toBe(72530);
    expect(getRow()).toMatchObject({ purchaseTransactionId: null, purchaseAccountId: null });
    expect(prisma.assetValueHistory.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'v-buy' }, data: expect.objectContaining({ note: 'Initial value' }) }),
    );
  });

  it("refuses a price the wallet can't cover and leaves the purchase as it was", async () => {
    const { service } = setup();
    await expect(service.update('biz-1', 'asset-1', { purchasePrice: 80000 }, 'user-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lets a lower price through on a wallet that was already short', async () => {
    const { service, balances } = setup({ ...baseAsset, purchaseAccountId: 'cash' }, { cash: -67000 });
    await service.update('biz-1', 'asset-1', { purchaseAccountId: 'cash', purchasePrice: 69000 }, 'user-1');
    expect(balances.cash).toBe(-67000 + 70000 - 69000);
  });

  it('refuses a purchase day after a value recorded since, or after the sale', async () => {
    const { service } = setup();
    await expect(service.update('biz-1', 'asset-1', { purchaseDate: '2025-07-01' }, 'user-1')).rejects.toThrow("can't be later than a value");
  });

  it('corrects a sale into the same wallet: only the difference has to be there', async () => {
    const sold = {
      ...baseAsset,
      status: 'SOLD',
      soldAt: day('2026-08-12'),
      soldPrice: new Prisma.Decimal(120000),
      soldAccountId: 'cash',
      soldTransactionId: 't-sale',
    };
    const { service, balances, getRow } = setup(sold, { bkash: 2530, cash: 5000 });
    await service.editSale('biz-1', 'asset-1', { soldPrice: 118000, soldAccountId: 'cash', date: '2026-08-12', notes: 'Sold to a neighbour' }, 'user-1');
    expect(balances.cash).toBe(5000 - 120000 + 118000);
    expect(getRow()).toMatchObject({ soldTransactionId: 't-new-1', soldNote: 'Sold to a neighbour' });
  });

  it('refuses to move a sale out of a wallet that has spent its proceeds', async () => {
    const sold = {
      ...baseAsset,
      status: 'SOLD',
      soldAt: day('2026-08-12'),
      soldPrice: new Prisma.Decimal(120000),
      soldAccountId: 'cash',
      soldTransactionId: 't-sale',
    };
    const { service } = setup(sold, { bkash: 2530, cash: 5000 });
    await expect(service.editSale('biz-1', 'asset-1', { soldPrice: 120000, soldAccountId: 'bkash', date: '2026-08-12' }, 'user-1')).rejects.toThrow(
      "can't be taken back",
    );
  });

  it('deletes a sold asset with both its postings, and its undo brings all of it back', async () => {
    const sold = {
      ...baseAsset,
      status: 'SOLD',
      soldAt: day('2026-08-12'),
      soldPrice: new Prisma.Decimal(60000),
      soldAccountId: 'cash',
      soldTransactionId: 't-sale',
    };
    const { service, transactions, balances, postings, getRow, getDeletion } = setup(sold, { bkash: 2530, cash: 70000 });
    await service.remove('biz-1', 'asset-1', 'user-1');
    expect(transactions.voidTransaction).toHaveBeenCalledWith('biz-1', 't-sale', ASSET_DELETED_REASON, 'user-1', expect.anything());
    expect(transactions.voidTransaction).toHaveBeenCalledWith('biz-1', 't-buy', ASSET_DELETED_REASON, 'user-1', expect.anything());
    expect(getRow()).toBeNull();
    expect(getDeletion()).toMatchObject({ assetId: 'asset-1', deletedBy: 'user-1' });
    expect(balances).toMatchObject({ bkash: 72530, cash: 10000 });

    await service.restore('biz-1', 'asset-1', 'user-1');
    expect(postings['t-buy'].status).toBe('POSTED');
    expect(postings['t-sale'].status).toBe('POSTED');
    expect(balances).toMatchObject({ bkash: 2530, cash: 70000 });
    expect(getRow()).toMatchObject({ id: 'asset-1', status: 'SOLD', soldNote: null });
  });

  it('keeps the undo to the person who deleted, inside the window', async () => {
    const { service } = setup();
    await service.remove('biz-1', 'asset-1', 'user-1');
    await expect(service.restore('biz-1', 'asset-1', 'user-2')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.restore('biz-1', 'asset-1', 'user-1', new Date(Date.now() + 11 * 60_000))).rejects.toBeInstanceOf(BadRequestException);
  });
});
