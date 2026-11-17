import { NotFoundException } from '@nestjs/common';
import { AnnouncementsService } from './announcements.service.js';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  title: 'New',
  titleBn: null,
  body: 'Body',
  bodyBn: null,
  type: 'INFO',
  targetPlan: null,
  startAt: new Date('2026-11-01T03:00:00Z'),
  endAt: null,
  isActive: true,
  linkUrl: null,
  createdBy: 'admin',
  createdAt: new Date('2026-11-01T03:00:00Z'),
  deletedAt: null,
  ...over,
});

const setup = (found: ReturnType<typeof row> | null) => {
  const tx = {
    announcement: { update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...found, ...data })) },
    userNotification: { updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  const prisma = {
    announcement: {
      findUnique: vi.fn().mockResolvedValue(found),
      findMany: vi.fn().mockResolvedValue([{ id: 'live' }]),
      update: vi.fn(({ data }: { data: Record<string, unknown> }) => ({ ...found, ...data })),
    },
    auditLog: { create: vi.fn(() => ({})) },
    $transaction: vi.fn(async (work: unknown) => (typeof work === 'function' ? (work as (t: typeof tx) => unknown)(tx) : Promise.all(work as unknown[]))),
  };
  return { service: new AnnouncementsService(prisma as never), prisma, tx };
};

describe('AnnouncementsService', () => {
  it('deletes for everyone by marking it, so Undo can bring it back', async () => {
    const { service, prisma } = setup(row());
    await service.remove('a1', 'admin', '1.2.3.4');
    expect(prisma.announcement.update).toHaveBeenCalledWith({ where: { id: 'a1' }, data: { deletedAt: expect.any(Date) } });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'ANNOUNCEMENT_DELETED', ipAddress: '1.2.3.4' }) });
  });

  it('brings back only a deleted one', async () => {
    await expect(setup(row()).service.restore('a1', 'admin')).rejects.toBeInstanceOf(NotFoundException);
    const { service, prisma } = setup(row({ deletedAt: new Date() }));
    await expect(service.restore('a1', 'admin')).resolves.toMatchObject({ id: 'a1', deletedAt: null, status: 'ACTIVE' });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'ANNOUNCEMENT_RESTORED' }) });
  });

  it('refuses to edit a deleted one', async () => {
    await expect(setup(row({ deletedAt: new Date() })).service.update('a1', { title: 'x' }, 'admin')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rewrites the bells it is in when its words change, and not otherwise', async () => {
    const words = setup(row());
    await words.service.update('a1', { title: 'Newer' }, 'admin');
    expect(words.tx.userNotification.updateMany).toHaveBeenCalledWith({
      where: { key: 'announcement:a1' },
      data: { data: { title: 'Newer', titleBn: null, body: 'Body', bodyBn: null } },
    });
    const off = setup(row());
    await off.service.update('a1', { isActive: false }, 'admin');
    expect(off.tx.userNotification.updateMany).not.toHaveBeenCalled();
    expect(off.tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'ANNOUNCEMENT_UPDATED' }) });
  });

  it('names the bell rows to leave out: deleted, turned off or gone', async () => {
    const { service } = setup(null);
    await expect(service.hiddenFromBell(['live', 'gone'])).resolves.toEqual(new Set(['gone']));
    await expect(service.hiddenFromBell([])).resolves.toEqual(new Set());
  });
});
