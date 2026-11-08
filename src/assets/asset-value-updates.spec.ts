import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AssetsService } from './assets.service.js';

const day = (date: string) => new Date(`${date}T00:00:00.000Z`);
const purchase = { id: 'v-buy', recordedAt: day('2024-01-10'), note: 'Initial purchase value', value: 100 };
const check = { id: 'v-check', recordedAt: day('2025-06-01'), note: null, value: 150 };
const later = { id: 'v-later', recordedAt: day('2026-03-01'), note: null, value: 130 };

const setup = ({ status = 'ACTIVE', rows = [purchase, check, later] }: { status?: string; rows?: (typeof purchase | typeof check)[] } = {}) => {
  const asset = { id: 'asset-1', businessId: 'biz-1', status, purchaseDate: day('2024-01-10') };
  let history = [...rows];
  const prisma = {
    asset: {
      findUnique: vi.fn().mockResolvedValue(asset),
      update: vi.fn(({ data }: { data: object }) => Promise.resolve({ ...asset, ...data })),
    },
    assetValueHistory: {
      findMany: vi.fn(() => Promise.resolve(history.map(({ id, recordedAt, note }) => ({ id, recordedAt, note })))),
      findFirst: vi.fn(() => Promise.resolve([...history].sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime())[0] ?? null)),
      update: vi.fn(({ where, data }: { where: { id: string }; data: { value: number; recordedAt: Date; note: string | null } }) => {
        history = history.map((row) => (row.id === where.id ? { ...row, ...data } : row));
        return Promise.resolve({});
      }),
      delete: vi.fn(({ where }: { where: { id: string } }) => {
        history = history.filter((row) => row.id !== where.id);
        return Promise.resolve({});
      }),
    },
    $transaction: vi.fn((run: (tx: unknown) => unknown) => run(prisma)),
  };
  return { service: new AssetsService(prisma as never, {} as never), prisma };
};

describe('AssetsService value updates', () => {
  it('deletes a later value update and takes the value today from the newest left', async () => {
    const { service, prisma } = setup();
    await service.deleteValueUpdate('biz-1', 'asset-1', 'v-later');
    expect(prisma.assetValueHistory.delete).toHaveBeenCalledWith({ where: { id: 'v-later' } });
    expect(prisma.asset.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'asset-1' }, data: { currentValue: 150 } }));
  });

  it('edits a value update and refreshes the value today', async () => {
    const { service, prisma } = setup();
    await service.editValueUpdate('biz-1', 'asset-1', 'v-later', { value: 175, date: '2026-04-01', note: 'Broker rate' });
    expect(prisma.assetValueHistory.update).toHaveBeenCalledWith({
      where: { id: 'v-later' },
      data: { value: 175, note: 'Broker rate', recordedAt: new Date('2026-04-01') },
    });
    expect(prisma.asset.update).toHaveBeenCalledWith(expect.objectContaining({ data: { currentValue: 175 } }));
  });

  it("keeps the purchase's own row", async () => {
    const { service, prisma } = setup();
    await expect(service.deleteValueUpdate('biz-1', 'asset-1', 'v-buy')).rejects.toThrow(BadRequestException);
    await expect(service.editValueUpdate('biz-1', 'asset-1', 'v-buy', { value: 90, date: '2024-01-10' })).rejects.toThrow(BadRequestException);
    expect(prisma.assetValueHistory.delete).not.toHaveBeenCalled();
    expect(prisma.assetValueHistory.update).not.toHaveBeenCalled();
  });

  it("closes a sold asset's history", async () => {
    const { service, prisma } = setup({ status: 'SOLD' });
    await expect(service.deleteValueUpdate('biz-1', 'asset-1', 'v-check')).rejects.toThrow(BadRequestException);
    expect(prisma.assetValueHistory.delete).not.toHaveBeenCalled();
  });

  it('refuses an update of another asset, and a day before the purchase', async () => {
    const { service, prisma } = setup();
    await expect(service.deleteValueUpdate('biz-1', 'asset-1', 'v-elsewhere')).rejects.toThrow(NotFoundException);
    await expect(service.editValueUpdate('biz-1', 'asset-1', 'v-check', { value: 120, date: '2023-12-31' })).rejects.toThrow(BadRequestException);
    expect(prisma.assetValueHistory.update).not.toHaveBeenCalled();
  });
});
