import { SystemMessagesService } from './system-messages.service.js';

const person = { name: 'Nadia Islam', email: 'nadia@example.com', phone: '01711000000', phoneVerifiedAt: new Date(), preferredLanguage: 'BN', subscription: { plan: { name: 'Pro' } } };

const template = (channel: 'EMAIL' | 'SMS' | 'IN_APP_PUSH', isActive = true) => ({
  id: 't1',
  key: 'payment_successful',
  channel,
  subjectEn: 'Payment received -- {{invoiceNumber}}',
  subjectBn: 'পেমেন্ট গৃহীত -- {{invoiceNumber}}',
  bodyEn: 'Hi {{userName}}, {{amount}} {{currency}} received.',
  bodyBn: 'হ্যালো {{userName}}, {{amount}} {{currency}} পেয়েছি।',
  variables: [],
  isActive,
  updatedAt: new Date(),
});

function setup(found: ReturnType<typeof template> | null, user: typeof person | null = person) {
  const prisma = {
    notificationTemplate: { findUnique: vi.fn(async () => found) },
    user: { findUnique: vi.fn(async () => user) },
    userNotification: { createMany: vi.fn(async () => ({ count: 1 })) },
    notificationLog: { create: vi.fn(async () => ({})) },
  };
  const mail = { configured: true, platformName: vi.fn(async () => 'Smartly'), sendTemplatedEmail: vi.fn(async () => undefined) };
  const sms = { send: vi.fn(async () => undefined) };
  const config = { get: vi.fn(() => 'https://app.example') };
  const service = new SystemMessagesService(prisma as never, mail as never, sms as never, config as never);
  return { service, prisma, mail, sms };
}

describe('SystemMessagesService', () => {
  it('answers OFF for a missing or switched-off template, so the built-in message goes', async () => {
    expect(await setup(null).service.send('payment_successful', 'u1')).toBe('OFF');
    const off = setup(template('EMAIL', false));
    expect(await off.service.send('payment_successful', 'u1')).toBe('OFF');
    expect(off.mail.sendTemplatedEmail).not.toHaveBeenCalled();
    expect(off.prisma.notificationLog.create).not.toHaveBeenCalled();
  });

  it('emails the template in the person’s language with its values and attachments, and logs it', async () => {
    const { service, mail, prisma } = setup(template('EMAIL'));
    const file = { filename: 'INV-1.pdf', content: Buffer.from('pdf') };
    const outcome = await service.send('payment_successful', 'u1', {
      values: (language) => ({ amount: language === 'BN' ? '১,২৯৯' : '1,299', currency: 'BDT', invoiceNumber: 'INV-1' }),
      link: 'https://app.example/settings/plans',
      attachments: async () => [file],
    });
    expect(outcome).toBe('SENT');
    expect(mail.sendTemplatedEmail).toHaveBeenCalledWith(
      'nadia@example.com',
      'bn',
      { subject: 'পেমেন্ট গৃহীত -- INV-1', body: 'হ্যালো Nadia Islam, ১,২৯৯ BDT পেয়েছি।', link: 'https://app.example/settings/plans' },
      [file],
    );
    expect(prisma.notificationLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ platformUserId: 'u1', campaignId: null, templateKey: 'payment_successful', channel: 'EMAIL', status: 'SENT' }) });
  });

  it('texts only a verified phone, and logs a failure without throwing', async () => {
    const sent = setup(template('SMS'));
    expect(await sent.service.send('payment_failed', 'u1', { values: { amount: '1,299', currency: 'BDT' } })).toBe('SENT');
    expect(sent.sms.send).toHaveBeenCalledWith('01711000000', 'হ্যালো Nadia Islam, 1,299 BDT পেয়েছি।', 'transactional');

    const unverified = setup(template('SMS'), { ...person, phoneVerifiedAt: null as unknown as Date });
    expect(await unverified.service.send('payment_failed', 'u1')).toBe('FAILED');
    expect(unverified.sms.send).not.toHaveBeenCalled();
    expect(unverified.prisma.notificationLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: 'FAILED', errorMessage: 'No verified phone' }) });
  });

  it('puts an in-app message in the bell row it is given, with the words as its body', async () => {
    const { service, prisma } = setup({ ...template('IN_APP_PUSH'), subjectEn: '', subjectBn: '' });
    const bell = { key: 'support:m1', type: 'SUPPORT_REPLY' as const, data: { ticketId: 't1', subject: 'Export' } };
    expect(await service.send('ticket_reply', 'u1', { values: { amount: '5', currency: 'BDT' }, bell })).toBe('SENT');
    expect(prisma.userNotification.createMany).toHaveBeenCalledWith({
      data: [{ userId: 'u1', key: 'support:m1', type: 'SUPPORT_REPLY', businessId: null, data: { ticketId: 't1', subject: 'Export', body: 'হ্যালো Nadia Islam, 5 BDT পেয়েছি।' } }],
      skipDuplicates: true,
    });
  });
});
