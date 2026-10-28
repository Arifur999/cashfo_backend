import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ListErrorLogsQueryDto } from './dto/list-error-logs-query.dto.js';
import { ErrorLogsService, errorGroupConditions, resolveAllWhere } from './error-logs.service.js';

const setup = ({ logs = [] as object[], total = 0 } = {}) => {
  const prisma = { errorLog: { findMany: vi.fn().mockResolvedValue(logs), count: vi.fn().mockResolvedValue(total) } };
  return { service: new ErrorLogsService(prisma as never), prisma };
};

// The where clause one list call gave its page, checked to be the same one
// it counted with.
const whereOf = (prisma: ReturnType<typeof setup>['prisma']) => {
  const { where } = prisma.errorLog.findMany.mock.calls[0][0] as { where: object };
  expect(prisma.errorLog.count).toHaveBeenCalledWith({ where });
  return where;
};

const byDigest = (digest: string) => ({ metadata: { path: ['digest'], equals: digest } });
const byApp = (app: string) => ({ metadata: { path: ['app'], equals: app } });

describe('ErrorLogsService.list', () => {
  it('filters as before when no digest or app is asked for', async () => {
    const { service, prisma } = setup();
    await service.list({ source: 'ADMIN_FRONTEND', severity: 'MEDIUM', resolved: 'false' });
    expect(whereOf(prisma)).toStrictEqual({ source: 'ADMIN_FRONTEND', severity: 'MEDIUM', resolved: false });
  });

  it('filters nothing for an empty query', async () => {
    const { service, prisma } = setup();
    await service.list({});
    expect(whereOf(prisma)).toStrictEqual({});
  });

  it('finds the row behind a reference a customer quotes, by metadata.digest', async () => {
    const { service, prisma } = setup();
    await service.list({ digest: '2683523098' });
    expect(whereOf(prisma)).toStrictEqual({ AND: [byDigest('2683523098')] });
  });

  it("keeps only the customer app's reports, by metadata.app", async () => {
    const { service, prisma } = setup();
    await service.list({ source: 'ADMIN_FRONTEND', app: 'customer' });
    expect(whereOf(prisma)).toStrictEqual({ source: 'ADMIN_FRONTEND', AND: [byApp('customer')] });
  });

  it('takes both together, each its own condition on metadata, alongside the other filters', async () => {
    const { service, prisma } = setup();
    await service.list({ resolved: 'true', dateFrom: '2026-10-01T00:00:00.000Z', digest: '2683523098', app: 'customer' });
    expect(whereOf(prisma)).toStrictEqual({
      resolved: true,
      createdAt: { gte: new Date('2026-10-01T00:00:00.000Z') },
      AND: [byDigest('2683523098'), byApp('customer')],
    });
  });

  it('answers the same page shape, newest first', async () => {
    const rows = [{ id: 'log-2' }, { id: 'log-1' }];
    const { service, prisma } = setup({ logs: rows, total: 41 });
    await expect(service.list({ digest: '2683523098', page: 3, limit: 20 })).resolves.toStrictEqual({
      data: rows,
      meta: { page: 3, limit: 20, total: 41, totalPage: 3 },
    });
    expect(prisma.errorLog.findMany).toHaveBeenCalledWith({ where: { AND: [byDigest('2683523098')] }, orderBy: { createdAt: 'desc' }, skip: 40, take: 20 });
  });
});

describe('ListErrorLogsQueryDto', () => {
  // The global pipe, as main.ts sets it up.
  const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
  const parse = (query: Record<string, unknown>) => pipe.transform(query, { type: 'query', metatype: ListErrorLogsQueryDto });
  // The pipe's messages for a refused query.
  const refusal = async (query: Record<string, unknown>) => {
    const error = await parse(query).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(BadRequestException);
    return ((error as BadRequestException).getResponse() as { message: string[] }).message;
  };

  it('takes a reference and the customer app, either or both, or neither', async () => {
    await expect(parse({})).resolves.toEqual({});
    await expect(parse({ resolved: 'false', within: 'all' })).resolves.toEqual({ resolved: 'false', within: 'all' });
    await expect(parse({ digest: ' 2683523098 ' })).resolves.toEqual({ digest: '2683523098' });
    await expect(parse({ app: 'customer' })).resolves.toEqual({ app: 'customer' });
    await expect(parse({ digest: 'd'.repeat(64), app: 'customer' })).resolves.toEqual({ digest: 'd'.repeat(64), app: 'customer' });
  });

  it.each([
    ['an empty reference', { digest: '' }, ['digest should not be empty']],
    ['a blank reference', { digest: '   ' }, ['digest should not be empty']],
    ['a reference over 64 characters', { digest: 'd'.repeat(65) }, ['digest must be shorter than or equal to 64 characters']],
    ['an app other than the customer app', { app: 'admin' }, ['app must be one of the following values: customer']],
    ['an empty app', { app: '' }, ['app must be one of the following values: customer']],
    ['a field it does not know', { userId: 'user-1' }, ['property userId should not exist']],
  ])('refuses %s', async (_, query, messages) => {
    expect(await refusal(query)).toEqual(messages);
  });

  it('refuses a reference sent twice', async () => {
    // ?digest=a&digest=b arrives as an array.
    expect(await refusal({ digest: ['2683523098', '1234'] })).toContain('digest must be a string');
  });
});

describe('errorGroupConditions', () => {
  const now = new Date('2026-10-28T06:00:00.000Z');
  const sqlOf = (query: Parameters<typeof errorGroupConditions>[0]) => {
    const parts = errorGroupConditions(query, now);
    return { sql: parts.map((part) => part.sql), values: parts.flatMap((part) => part.values) };
  };

  it('filters nothing for an empty query', () => {
    expect(sqlOf({})).toEqual({ sql: [], values: [] });
  });

  it('turns each filter into a bound condition', () => {
    expect(sqlOf({ resolved: 'false', source: 'BACKEND_API', severity: 'HIGH', within: '24h' })).toEqual({
      sql: ['"resolved" = false', '"source" = CAST(? AS "ErrorSource")', '"severity" = CAST(? AS "Severity")', '"createdAt" >= ?'],
      values: ['BACKEND_API', 'HIGH', new Date('2026-10-27T06:00:00.000Z')],
    });
    expect(sqlOf({ from: '2026-10-01T00:00:00.000Z', to: '2026-10-02T00:00:00.000Z' }).values).toEqual([
      new Date('2026-10-01T00:00:00.000Z'),
      new Date('2026-10-02T00:00:00.000Z'),
    ]);
  });

  it("narrows to a screen's reference and to the customer app, bound", () => {
    expect(sqlOf({ digest: '2413785441', app: 'customer' })).toEqual({
      sql: ['"metadata"->>\'digest\' = ?', '"metadata"->>\'app\' = ?'],
      values: ['2413785441', 'customer'],
    });
  });
});

describe('ErrorLogsService.groups', () => {
  it('answers a page of groups with the admin-list meta', async () => {
    const group = { message: 'boom', source: 'BACKEND_API', severity: 'HIGH', count: 5 };
    const prisma = {
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([group])
        .mockResolvedValueOnce([{ total: 41 }]),
    };
    const service = new ErrorLogsService(prisma as never);
    await expect(service.groups({ page: 3, limit: 20 })).resolves.toEqual({ data: [group], meta: { page: 3, limit: 20, total: 41, totalPage: 3 } });
  });
});

describe('ErrorLogsService.resolveAll', () => {
  const setup = (count: number) => {
    const tx = { errorLog: { updateMany: vi.fn().mockResolvedValue({ count }) }, auditLog: { create: vi.fn() } };
    const prisma = { $transaction: vi.fn((run: (client: typeof tx) => unknown) => run(tx)) };
    return { service: new ErrorLogsService(prisma as never), tx };
  };

  it('needs something to say which errors', async () => {
    expect(resolveAllWhere({})).toBeNull();
    expect(resolveAllWhere({ ids: [] })).toBeNull();
    await expect(setup(0).service.resolveAll({}, 'admin-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it("closes a group's open rows with one audit entry", async () => {
    const { service, tx } = setup(5);
    await expect(service.resolveAll({ message: 'boom', source: 'BACKEND_API' }, 'admin-1', '1.2.3.4')).resolves.toEqual({ resolved: 5 });
    expect(tx.errorLog.updateMany).toHaveBeenCalledWith({
      where: { resolved: false, message: 'boom', source: 'BACKEND_API' },
      data: { resolved: true, resolvedBy: 'admin-1', resolvedAt: expect.any(Date) },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        adminUserId: 'admin-1',
        action: 'ERROR_LOGS_RESOLVED',
        entityType: 'ErrorLog',
        newValue: { message: 'boom', source: 'BACKEND_API', count: 5 },
        ipAddress: '1.2.3.4',
      },
    });
  });

  it('writes no audit entry when nothing was open', async () => {
    const { service, tx } = setup(0);
    await expect(service.resolveAll({ ids: ['0b8f7a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b'] }, 'admin-1')).resolves.toEqual({ resolved: 0 });
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
