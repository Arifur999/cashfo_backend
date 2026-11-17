import { AnnouncementsService } from './announcements.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';

// A fake Prisma whose $transaction hands the same client in, recording the
// audit rows written.
const fakePrisma = () => {
  const audits: Array<Record<string, unknown>> = [];
  const row = {
    id: 'a1',
    title: 'Old',
    type: 'INFO',
    targetPlan: null,
    startAt: new Date('2026-11-01T00:00:00Z'),
    endAt: null,
    isActive: true,
  };
  const client = {
    announcement: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...row, ...data, id: 'a1' })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...row, ...data })),
      findUnique: vi.fn(async () => row),
    },
    auditLog: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => audits.push(data)) },
    // An edit to the words reaches the bell rows the announcement is in.
    userNotification: { updateMany: vi.fn(async () => ({ count: 0 })) },
  };
  const prisma = { ...client, $transaction: vi.fn(async (fn: (tx: typeof client) => unknown) => fn(client)) };
  return { prisma: prisma as unknown as PrismaService, audits };
};

describe('announcement writes and the audit log', () => {
  it('logs who made an announcement, from where, and what it said', async () => {
    const { prisma, audits } = fakePrisma();
    await new AnnouncementsService(prisma).create({ title: 'New feature', body: 'Hello', type: 'INFO', startAt: '2026-11-15T00:00:00Z' } as never, 'admin-1', '203.0.113.9');
    expect(audits).toEqual([expect.objectContaining({ adminUserId: 'admin-1', action: 'ANNOUNCEMENT_CREATED', entityId: 'a1', ipAddress: '203.0.113.9', newValue: expect.objectContaining({ title: 'New feature' }) })]);
  });

  it('logs an edit with the wording before and after', async () => {
    const { prisma, audits } = fakePrisma();
    await new AnnouncementsService(prisma).update('a1', { title: 'New' } as never, 'admin-2', '198.51.100.4');
    expect(audits).toEqual([
      expect.objectContaining({
        adminUserId: 'admin-2',
        action: 'ANNOUNCEMENT_UPDATED',
        ipAddress: '198.51.100.4',
        oldValue: expect.objectContaining({ title: 'Old' }),
        newValue: expect.objectContaining({ title: 'New' }),
      }),
    ]);
  });
});
