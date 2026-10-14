import { BadRequestException, ConflictException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateTranslationDto } from './dto/create-translation.dto.js';
import { TranslationsService } from './translations.service.js';

const row = (key: string, en = key, bn = key) => ({ key, en, bn });

const setup = ({ rows = [] as ReturnType<typeof row>[], existing = null as object | null, clash = null as object | null } = {}) => {
  const tx = {
    translationString: { create: vi.fn((args: { data: object }) => Promise.resolve({ id: 't-1', ...args.data })) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    translationString: {
      findMany: vi.fn().mockResolvedValue(rows),
      findUnique: vi.fn().mockResolvedValue(existing),
      findFirst: vi.fn().mockResolvedValue(clash),
    },
    $transaction: vi.fn((work: (client: typeof tx) => unknown) => work(tx)),
  };
  return { service: new TranslationsService(prisma as never), tx };
};

describe('TranslationsService.export', () => {
  it('nests keys by their dots', async () => {
    const { service } = setup({ rows: [row('dashboard.total_income', 'Total Income', 'মোট আয়')] });
    const { en, bn } = await service.export();
    expect(JSON.parse(JSON.stringify(en))).toEqual({ dashboard: { total_income: 'Total Income' } });
    expect(JSON.parse(JSON.stringify(bn))).toEqual({ dashboard: { total_income: 'মোট আয়' } });
  });

  it('never writes into Object.prototype or replaces Object.keys', async () => {
    const { service } = setup({ rows: [row('__proto__.polluted', 'yes'), row('constructor.keys', 'oops'), row('a.prototype.b', 'no')] });
    await service.export();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(typeof Object.keys).toBe('function');
  });

  it('keeps the first of two clashing keys instead of throwing', async () => {
    const { service } = setup({ rows: [row('dashboard', 'Dashboard'), row('dashboard.title', 'Title')] });
    const { en } = await service.export();
    expect(JSON.parse(JSON.stringify(en))).toEqual({ dashboard: 'Dashboard' });
  });
});

describe('TranslationsService.create', () => {
  it('refuses reserved segments', async () => {
    const { service, tx } = setup();
    await expect(service.create({ key: 'constructor.keys', en: 'x', bn: 'x' }, 'admin-1')).rejects.toThrow(BadRequestException);
    expect(tx.translationString.create).not.toHaveBeenCalled();
  });

  it('refuses a key that clashes with an existing group or leaf', async () => {
    const { service } = setup({ clash: { key: 'dashboard.title' } });
    await expect(service.create({ key: 'dashboard', en: 'x', bn: 'x' }, 'admin-1')).rejects.toThrow(ConflictException);
  });

  it('creates and audits a new key', async () => {
    const { service, tx } = setup();
    await service.create({ key: 'reports.title', en: 'Reports', bn: 'রিপোর্ট' }, 'admin-1', '203.0.113.9');
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'TRANSLATION_CREATED', adminUserId: 'admin-1', ipAddress: '203.0.113.9' }) });
  });
});

describe('CreateTranslationDto.key', () => {
  const errorsFor = async (key: string) => validate(plainToInstance(CreateTranslationDto, { key, en: 'x', bn: 'x' }));
  it.each(['dashboard.total_income', 'auth.login_button', 'a1.b2'])('accepts %s', async (key) => {
    expect(await errorsFor(key)).toHaveLength(0);
  });
  it.each(['__proto__.x', 'Dashboard.Title', 'a..b', '_a.b', 'a.b_', 'a b'])('rejects %s', async (key) => {
    expect((await errorsFor(key)).length).toBeGreaterThan(0);
  });
});
