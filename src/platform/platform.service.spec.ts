import { PlatformService } from './platform.service.js';

const serviceWith = (strings: { en: string; bn: string }[]) => {
  const prisma = { translationString: { findMany: vi.fn().mockResolvedValue(strings) } };
  return { service: new PlatformService(prisma as never, {} as never, {} as never, {} as never, {} as never), prisma };
};

describe('PlatformService.translations', () => {
  it('maps the English text to the Bangla, the latest edit winning', async () => {
    const { service, prisma } = serviceWith([
      { en: 'Save', bn: 'সেভ' },
      { en: 'Cancel', bn: 'বাতিল করুন' },
      { en: 'Save ', bn: 'সংরক্ষণ করুন' },
    ]);
    await expect(service.translations()).resolves.toEqual({ bn: { Save: 'সংরক্ষণ করুন', Cancel: 'বাতিল করুন' } });
    expect(prisma.translationString.findMany).toHaveBeenCalledWith({ select: { en: true, bn: true }, orderBy: { updatedAt: 'asc' } });
  });

  it('skips blank strings', async () => {
    const { service } = serviceWith([
      { en: 'Save', bn: '  ' },
      { en: ' ', bn: 'কিছু' },
    ]);
    await expect(service.translations()).resolves.toEqual({ bn: {} });
  });

  it('keeps an English text like __proto__ as plain data', async () => {
    const { service } = serviceWith([{ en: '__proto__', bn: 'x' }]);
    const { bn } = await service.translations();
    expect(Object.hasOwn(bn, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(bn)).toBe(Object.prototype);
  });
});
