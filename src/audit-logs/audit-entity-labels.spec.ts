import type { PrismaService } from '../prisma/prisma.service.js';
import { withEntityLabels } from './audit-entity-labels.js';

// A table that answers `findMany({ where: { id: { in } } })` and counts reads.
const table = (rows: Array<Record<string, unknown>>) => {
  const reads = { count: 0 };
  return {
    reads,
    findMany: async ({ where }: { where: { id: { in: string[] } } }) => {
      reads.count += 1;
      return rows.filter((row) => where.id.in.includes(row.id as string));
    },
  };
};

const fakePrisma = () => {
  const tables = {
    user: table([{ id: 'u-abir', name: 'Abir Hasan' }]),
    subscriptionPlan: table([{ id: 'plan-yearly', name: 'Yearly Pro' }]),
    payment: table([{ id: 'pay-1', platformUserId: 'pu-mahbub' }]),
    platformUser: table([{ id: 'pu-mahbub', name: 'Mahbub Alam' }]),
  };
  return { tables, prisma: tables as unknown as PrismaService };
};

const entry = (entityType: string, entityId: string | null) => ({ entityType, entityId });

describe('withEntityLabels', () => {
  it('names a user, a plan and the person behind a payment', async () => {
    const { prisma } = fakePrisma();
    const labelled = await withEntityLabels(prisma, [entry('User', 'u-abir'), entry('SubscriptionPlan', 'plan-yearly'), entry('Payment', 'pay-1')]);
    expect(labelled.map((row) => row.entityLabel)).toEqual(['Abir Hasan', 'Yearly Pro', 'Mahbub Alam']);
  });

  it('leaves the label empty for a deleted record, a record without an id, or an unknown type', async () => {
    const { prisma } = fakePrisma();
    const labelled = await withEntityLabels(prisma, [entry('SubscriptionPlan', 'plan-gone'), entry('PlatformSetting', null), entry('Mystery', 'x')]);
    expect(labelled.map((row) => row.entityLabel)).toEqual([null, null, null]);
  });

  it('reads each record type once however many entries share it', async () => {
    const { prisma, tables } = fakePrisma();
    await withEntityLabels(prisma, [entry('User', 'u-abir'), entry('AdminUser', 'u-abir'), entry('User', 'u-abir'), entry('SubscriptionPlan', 'plan-yearly')]);
    // User and AdminUser are both read from the one identity table.
    expect(tables.user.reads.count).toBe(2);
    expect(tables.subscriptionPlan.reads.count).toBe(1);
  });
});
