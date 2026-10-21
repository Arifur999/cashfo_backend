import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ListErrorLogsQueryDto } from './dto/list-error-logs-query.dto.js';
import { ErrorLogsService } from './error-logs.service.js';

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
