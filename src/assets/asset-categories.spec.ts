import { BadRequestException, ConflictException } from '@nestjs/common';
import { AssetsService } from './assets.service.js';

const vehicle = { id: 'cat-vehicle', businessId: 'biz-1', name: 'Vehicle', icon: 'car', color: 'blue', isActive: true };

const setup = ({ categories = 3, assets = 0, on = 3 }: { categories?: number; assets?: number; on?: number } = {}) => {
  const prisma = {
    assetCategoryOption: {
      findUnique: vi.fn(({ where }: { where: { id?: string } }) => Promise.resolve(where.id === vehicle.id ? vehicle : null)),
      count: vi.fn(({ where }: { where: { isActive?: boolean } }) => Promise.resolve(where.isActive ? on : categories)),
      delete: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({ ...vehicle, isActive: false }),
    },
    asset: { count: vi.fn().mockResolvedValue(assets), updateMany: vi.fn() },
    $transaction: vi.fn((run: (tx: unknown) => unknown) => run(prisma)),
  };
  return { service: new AssetsService(prisma as never, {} as never), prisma };
};

describe('AssetsService asset categories', () => {
  it('deletes a category no asset uses', async () => {
    const { service, prisma } = setup();
    await expect(service.deleteCategory('biz-1', vehicle.id)).resolves.toEqual({ id: vehicle.id });
    expect(prisma.assetCategoryOption.delete).toHaveBeenCalledWith({ where: { id: vehicle.id } });
  });

  it('keeps a category that still files assets, sold ones included', async () => {
    const { service, prisma } = setup({ assets: 2 });
    await expect(service.deleteCategory('biz-1', vehicle.id)).rejects.toThrow(ConflictException);
    expect(prisma.asset.count).toHaveBeenCalledWith({ where: { businessId: 'biz-1', category: 'Vehicle' } });
    expect(prisma.assetCategoryOption.delete).not.toHaveBeenCalled();
  });

  it('keeps the last category', async () => {
    const { service, prisma } = setup({ categories: 1 });
    await expect(service.deleteCategory('biz-1', vehicle.id)).rejects.toThrow(BadRequestException);
    expect(prisma.assetCategoryOption.delete).not.toHaveBeenCalled();
  });

  it('refuses to switch off the last category that is on', async () => {
    const { service, prisma } = setup({ on: 1 });
    await expect(service.updateCategory('biz-1', vehicle.id, { isActive: false })).rejects.toThrow(BadRequestException);
    expect(prisma.assetCategoryOption.update).not.toHaveBeenCalled();
  });

  it('switches a category off while another stays on', async () => {
    const { service, prisma } = setup({ on: 2 });
    await service.updateCategory('biz-1', vehicle.id, { isActive: false });
    expect(prisma.assetCategoryOption.update).toHaveBeenCalledWith({ where: { id: vehicle.id }, data: { isActive: false } });
  });
});
