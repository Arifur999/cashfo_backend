import 'reflect-metadata';
import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { NotificationCampaignsService } from './notification-campaigns.service.js';

type Row = Record<string, unknown>;

const TEMPLATE = {
  id: 'tpl-1',
  key: 'promo_offer',
  channel: 'IN_APP_PUSH',
  subjectEn: 'Offer for {{firstName}}',
  subjectBn: '{{firstName}}, অফার',
  bodyEn: 'Your {{planName}} gets 15% off',
  bodyBn: 'আপনার {{planName}} এ ১৫% ছাড়',
  variables: [],
  isActive: true,
  updatedAt: new Date(),
};

const person = (id: string, name: string, preferredLanguage: 'EN' | 'BN') => ({
  id,
  name,
  email: `${id}@example.com`,
  preferredLanguage,
  subscription: { plan: { name: 'Free' } },
  ownedBusinesses: [],
});
const PEOPLE = [person('u1', 'Rahim Uddin', 'EN'), person('u2', 'Sharmin Akter', 'BN'), person('u3', 'Karim Mia', 'EN')];

const campaignRow = (over: Row = {}) => ({
  id: 'c1',
  title: 'Puja offer',
  templateKey: 'promo_offer',
  targetFilter: { planId: 'free' },
  channel: 'IN_APP_PUSH',
  status: 'DRAFT',
  scheduledFor: null,
  sentCount: 0,
  failedCount: 0,
  createdBy: 'admin-creator',
  sentAt: null as Date | null,
  createdAt: new Date('2026-10-01'),
  ...over,
});

const setup = (over: Row = {}, { logged = [] as string[], mailConfigured = true, template = TEMPLATE as Row } = {}) => {
  const campaign = campaignRow(over);
  const logs: Row[] = logged.map((platformUserId) => ({ platformUserId, campaignId: 'c1', status: 'SENT' }));
  const bells: Row[] = [];
  const prisma = {
    bulkNotificationCampaign: {
      findUnique: vi.fn(async () => ({ ...campaign })),
      findMany: vi.fn(async () => [{ ...campaign }]),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        if (where.status !== campaign.status) return { count: 0 };
        Object.assign(campaign, data);
        return { count: 1 };
      }),
      update: vi.fn(async ({ data }: { data: Row }) => {
        for (const [key, value] of Object.entries(data)) {
          const inc = (value as { increment?: number } | null)?.increment;
          (campaign as Row)[key] = inc !== undefined ? ((campaign as Row)[key] as number) + inc : value;
        }
        return { ...campaign };
      }),
    },
    notificationTemplate: { findUnique: vi.fn(async () => template) },
    user: {
      count: vi.fn(async () => PEOPLE.length),
      findMany: vi.fn(async ({ take, cursor }: { take: number; cursor?: { id: string } }) => {
        const start = cursor ? PEOPLE.findIndex((p) => p.id === cursor.id) + 1 : 0;
        return PEOPLE.slice(start, start + take);
      }),
    },
    notificationLog: {
      findMany: vi.fn(async () => logs.map((log) => ({ platformUserId: log.platformUserId }))),
      createMany: vi.fn(async ({ data }: { data: Row[] }) => {
        logs.push(...data);
        return { count: data.length };
      }),
      groupBy: vi.fn(async () => {
        const counts = new Map<unknown, number>();
        for (const log of logs) counts.set(log.status, (counts.get(log.status) ?? 0) + 1);
        return [...counts].map(([status, count]) => ({ status, _count: count }));
      }),
    },
    userNotification: {
      createMany: vi.fn(async ({ data }: { data: Row[] }) => {
        bells.push(...data);
        return { count: data.length };
      }),
    },
    auditLog: { create: vi.fn(async () => ({})) },
  };
  const mail = {
    configured: mailConfigured,
    platformName: vi.fn(async () => 'Smartly'),
    sendCampaignBatch: vi.fn(async (): Promise<Map<number, string>> => new Map()),
  };
  const push = { send: vi.fn(async () => 0) };
  const config = { get: vi.fn(() => 'https://app.example') };
  const service = new NotificationCampaignsService(prisma as never, mail as never, push as never, config as never);
  return { service, prisma, mail, push, campaign, logs, bells };
};

describe('NotificationCampaignsService.send, in-app', () => {
  it('gives each person a bell row in their language, logs it, and finishes SENT with the counts, skipping anyone already logged', async () => {
    const { service, prisma, push, logs, bells } = setup({}, { logged: ['u3'] });
    const result = await service.send('c1', 'admin-nadia', '1.2.3.4');

    expect(bells).toEqual([
      {
        userId: 'u1',
        key: 'campaign:c1',
        type: 'CAMPAIGN',
        businessId: null,
        data: { event: 'CAMPAIGN', campaignId: 'c1', title: 'Offer for Rahim', body: 'Your Free gets 15% off' },
      },
      {
        userId: 'u2',
        key: 'campaign:c1',
        type: 'CAMPAIGN',
        businessId: null,
        data: { event: 'CAMPAIGN', campaignId: 'c1', title: 'Sharmin, অফার', body: 'আপনার Free এ ১৫% ছাড়' },
      },
    ]);
    expect(logs.slice(1)).toEqual([
      expect.objectContaining({
        platformUserId: 'u1',
        campaignId: 'c1',
        templateKey: 'promo_offer',
        channel: 'IN_APP_PUSH',
        status: 'SENT',
        errorMessage: null,
      }),
      expect.objectContaining({ platformUserId: 'u2', status: 'SENT' }),
    ]);
    expect(result).toMatchObject({ status: 'SENT', sentCount: 3, failedCount: 0, audienceCount: 3, reachableCount: 3 });
    expect(result.sentAt).toBeInstanceOf(Date);
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ adminUserId: 'admin-nadia', action: 'CAMPAIGN_SENT', oldValue: { status: 'DRAFT' }, ipAddress: '1.2.3.4' }),
    });

    // Web push in each device's language.
    const messages = (push.send.mock.calls[0] as unknown as [{ userId: string; build: (locale: 'en' | 'bn') => Row }[]])[0];
    expect(messages.map((m) => m.userId)).toEqual(['u1', 'u2']);
    expect(messages[1].build('en')).toEqual({ title: 'Offer for Sharmin', body: 'Your Free gets 15% off', url: '/', tag: 'campaign:c1' });
  });

  it('refuses when another send claimed it first', async () => {
    const { service, prisma } = setup();
    prisma.bulkNotificationCampaign.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.send('c1', 'admin-nadia')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.userNotification.createMany).not.toHaveBeenCalled();
  });

  it('leaves a send that is still running alone, and picks up one that stalled', async () => {
    const running = setup({ status: 'SENDING', sentAt: new Date() });
    await expect(running.service.send('c1', 'admin-nadia')).rejects.toBeInstanceOf(ConflictException);

    const stalled = setup({ status: 'SENDING', sentAt: new Date(Date.now() - 60 * 60 * 1000) }, { logged: ['u1', 'u2'] });
    const result = await stalled.service.send('c1', 'admin-nadia');
    expect(stalled.bells.map((bell) => bell.userId)).toEqual(['u3']);
    expect(result).toMatchObject({ status: 'SENT', sentCount: 3 });
  });
});

describe('NotificationCampaignsService.send, email and SMS', () => {
  it('refuses up front when email or SMS cannot go out', async () => {
    const email = setup({ channel: 'EMAIL' }, { mailConfigured: false });
    const error = await email.service.send('c1', 'admin-nadia').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getResponse()).toMatchObject({ reason: 'EMAIL_NOT_CONFIGURED' });
    expect(email.campaign.status).toBe('DRAFT');

    const sms = setup({ channel: 'SMS' });
    const smsError = await sms.service.send('c1', 'admin-nadia').catch((e: unknown) => e);
    expect((smsError as ServiceUnavailableException).getResponse()).toMatchObject({ reason: 'SMS_NOT_CONFIGURED' });
  });

  it('logs an address Resend refused as FAILED and the rest as SENT; a failed request fails its round', async () => {
    const { service, mail, logs } = setup({ channel: 'EMAIL' });
    mail.sendCampaignBatch.mockResolvedValueOnce(new Map([[1, 'Invalid to field']]));
    const result = await service.send('c1', 'admin-nadia');

    const [emails, key] = mail.sendCampaignBatch.mock.calls[0] as unknown as [Row[], string];
    expect(emails[1]).toEqual({
      to: 'u2@example.com',
      locale: 'bn',
      email: { subject: 'Sharmin, অফার', body: 'আপনার Free এ ১৫% ছাড়', link: 'https://app.example' },
    });
    expect(key).toMatch(/^campaign-c1-[0-9a-f]{32}$/);
    expect(logs.map((log) => [log.platformUserId, log.status, log.errorMessage])).toEqual([
      ['u1', 'SENT', null],
      ['u2', 'FAILED', 'Invalid to field'],
      ['u3', 'SENT', null],
    ]);
    expect(result).toMatchObject({ status: 'SENT', sentCount: 2, failedCount: 1 });

    const down = setup({ channel: 'EMAIL' });
    down.mail.sendCampaignBatch.mockRejectedValueOnce(new Error('Resend is down'));
    expect(await down.service.send('c1', 'admin-nadia')).toMatchObject({ sentCount: 0, failedCount: 3 });
  });
});

describe('NotificationCampaignsService.sendDue', () => {
  it('starts a due scheduled campaign and audits it as the admin who made it', async () => {
    const { service, prisma, campaign } = setup({ status: 'SCHEDULED', scheduledFor: new Date(Date.now() - 1000) });
    await service.sendDue(new Date());
    await vi.waitFor(() => expect(campaign.status).toBe('SENT'));
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ adminUserId: 'admin-creator', oldValue: { status: 'SCHEDULED' } }),
    });
  });

  it('leaves a scheduled campaign whose template is off where it is', async () => {
    const { service, campaign, prisma } = setup({ status: 'SCHEDULED', scheduledFor: new Date(0) }, { template: { ...TEMPLATE, isActive: false } });
    await service.sendDue(new Date());
    expect(campaign.status).toBe('SCHEDULED');
    expect(prisma.bulkNotificationCampaign.updateMany).not.toHaveBeenCalled();
  });
});
