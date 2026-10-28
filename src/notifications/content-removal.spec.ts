import { BadRequestException, ConflictException } from '@nestjs/common';
import { AnnouncementsService } from '../announcements/announcements.service.js';
import { NotificationCampaignsService } from './notification-campaigns.service.js';
import { NotificationTemplatesService } from './notification-templates.service.js';

const audit = () => ({ create: vi.fn().mockResolvedValue({}) });

describe('deleting a notification template', () => {
  const setup = (template: Record<string, unknown> | null, waiting = 0) => {
    const prisma = {
      notificationTemplate: { findUnique: vi.fn().mockResolvedValue(template), delete: vi.fn().mockResolvedValue({}) },
      bulkNotificationCampaign: { count: vi.fn().mockResolvedValue(waiting) },
      auditLog: audit(),
    };
    return { service: new NotificationTemplatesService(prisma as never, {} as never, {} as never), prisma };
  };

  it('deletes one made in the panel and logs it', async () => {
    const { service, prisma } = setup({ id: 't1', key: 'eid_offer', channel: 'IN_APP_PUSH' });
    await expect(service.remove('t1', 'admin-1')).resolves.toEqual({ id: 't1' });
    expect(prisma.notificationTemplate.delete).toHaveBeenCalledWith({ where: { id: 't1' } });
    expect(prisma.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: 'NOTIFICATION_TEMPLATE_DELETED', oldValue: { key: 'eid_offer' } });
  });

  it('keeps a built-in one, and one a campaign still has to send', async () => {
    await expect(setup({ id: 't2', key: 'welcome', channel: 'EMAIL' }).service.remove('t2', 'admin-1')).rejects.toThrow(BadRequestException);
    await expect(setup({ id: 't3', key: 'eid_offer', channel: 'IN_APP_PUSH' }, 1).service.remove('t3', 'admin-1')).rejects.toThrow(ConflictException);
  });
});

describe('deleting a campaign', () => {
  const setup = (status: string, deleted = 1) => {
    const prisma = {
      bulkNotificationCampaign: {
        findUnique: vi.fn().mockResolvedValue({ id: 'c1', title: 'Eid', status }),
        deleteMany: vi.fn().mockResolvedValue({ count: deleted }),
      },
      auditLog: audit(),
    };
    return { service: new NotificationCampaignsService(prisma as never, {} as never, {} as never, {} as never, {} as never), prisma };
  };

  it('deletes one that never sent, guarded on its status', async () => {
    const { service, prisma } = setup('SCHEDULED');
    await expect(service.remove('c1', 'admin-1')).resolves.toEqual({ id: 'c1' });
    expect(prisma.bulkNotificationCampaign.deleteMany).toHaveBeenCalledWith({ where: { id: 'c1', status: 'SCHEDULED' } });
    expect(prisma.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: 'CAMPAIGN_DELETED' });
  });

  it('keeps a sent one, and loses to a send that just started', async () => {
    await expect(setup('SENT').service.remove('c1', 'admin-1')).rejects.toThrow(BadRequestException);
    await expect(setup('DRAFT', 0).service.remove('c1', 'admin-1')).rejects.toThrow(ConflictException);
  });
});

describe('deleting an announcement', () => {
  it('removes it and keeps what it said in the audit log', async () => {
    const prisma = {
      announcement: {
        findUnique: vi.fn().mockResolvedValue({ id: 'a1', title: 'Eid offer', type: 'PROMOTION', startAt: new Date('2026-10-01T00:00:00.000Z'), isActive: false }),
        delete: vi.fn().mockResolvedValue({}),
      },
      auditLog: audit(),
    };
    const service = new AnnouncementsService(prisma as never);
    await expect(service.remove('a1', 'admin-1', '1.2.3.4')).resolves.toEqual({ id: 'a1' });
    expect(prisma.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: 'ANNOUNCEMENT_DELETED', oldValue: { title: 'Eid offer' }, ipAddress: '1.2.3.4' });
  });
});

describe('sending a template test', () => {
  const template = { id: 't1', key: 'eid_offer', channel: 'IN_APP_PUSH', subjectEn: null, subjectBn: null, bodyEn: 'Hi {{firstName}}, try {{planName}}', bodyBn: 'হ্যালো {{firstName}}' };
  const setup = (configured = true) => {
    const prisma = {
      notificationTemplate: { findUnique: vi.fn().mockResolvedValue(template) },
      user: { findUnique: vi.fn().mockResolvedValue({ name: 'Nadia Rahman', email: 'nadia@example.com' }) },
    };
    const mail = { configured, platformName: vi.fn().mockResolvedValue('Smartly'), sendCampaignBatch: vi.fn().mockResolvedValue(new Map()) };
    const config = { get: vi.fn(() => 'https://app.example.com') };
    return { service: new NotificationTemplatesService(prisma as never, mail as never, config as never), mail };
  };

  it('emails the asking admin the template filled in for them, in the language picked', async () => {
    const { service, mail } = setup();
    await expect(service.sendTest('t1', 'admin-1', 'BN')).resolves.toEqual({ sentTo: 'nadia@example.com' });
    expect(mail.sendCampaignBatch).toHaveBeenCalledWith([
      { to: 'nadia@example.com', locale: 'bn', email: { subject: '[Test] eid_offer', body: 'হ্যালো Nadia', link: 'https://app.example.com' } },
    ]);
  });

  it("says so when email isn't set up", async () => {
    await expect(setup(false).service.sendTest('t1', 'admin-1')).rejects.toThrow('Email sending is not set up');
  });
});
