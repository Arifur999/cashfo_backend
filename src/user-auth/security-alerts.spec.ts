import { dhakaTimeLabel, failedTriesAlertDue, failedTriesKey, isKnownDevice } from './security-alerts.js';
import { SecurityAlertsService } from './security-alerts.service.js';

describe('security alert rules', () => {
  const now = new Date('2026-10-28T09:05:00Z');

  it('treats a device label seen before as known, whatever the IP', () => {
    expect(isKnownDevice('Chrome on Windows', ['Safari on iOS', 'Chrome on Windows'])).toBe(true);
    expect(isKnownDevice('Firefox on Linux', ['Chrome on Windows'])).toBe(false);
  });

  it('warns at five failures, then not again within the hour', () => {
    expect(failedTriesAlertDue(4, null, now)).toBe(false);
    expect(failedTriesAlertDue(5, null, now)).toBe(true);
    expect(failedTriesAlertDue(9, new Date(now.getTime() - 30 * 60 * 1000), now)).toBe(false);
    expect(failedTriesAlertDue(5, new Date(now.getTime() - 60 * 60 * 1000), now)).toBe(true);
  });

  it('keys the bell row by the hour', () => {
    expect(failedTriesKey(now)).toBe('failed-tries:2026-10-28T09');
  });

  it('words the time on the Dhaka clock in both languages', () => {
    expect(dhakaTimeLabel(now, 'en')).toBe('28 Oct 2026, 3:05 pm');
    expect(dhakaTimeLabel(now, 'bn')).toBe('২৮ অক্টোবর ২০২৬, বিকাল ৩:০৫');
    expect(dhakaTimeLabel(new Date('2026-10-27T18:30:00Z'), 'en')).toBe('28 Oct 2026, 12:30 am');
  });
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const setup = ({ user = {}, earlier = [] as string[], failures = 5, claimed = 1, configured = true } = {}) => {
  const account = {
    id: 'u1',
    name: 'Nadia',
    email: 'nadia@example.com',
    role: 'USER',
    status: 'ACTIVE',
    preferredLanguage: 'EN',
    alertNewDevice: true,
    alertFailedTries: true,
    failedTriesAlertedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...user,
  };
  const prisma = {
    user: { findUnique: vi.fn().mockResolvedValue(account), updateMany: vi.fn().mockResolvedValue({ count: claimed }) },
    userSession: { findMany: vi.fn().mockResolvedValue(earlier.map((deviceLabel) => ({ deviceLabel }))) },
    loginAttempt: { count: vi.fn().mockResolvedValue(failures) },
    userNotification: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  const mail = { configured, sendNewDeviceEmail: vi.fn(), sendFailedTriesEmail: vi.fn() };
  const verification = { sendAfterSignup: vi.fn() };
  const config = { get: vi.fn(() => 'https://app.example') };
  const service = new SecurityAlertsService(prisma as never, config as never, mail as never, verification as never);
  return { service, prisma, mail, verification };
};

const session = { id: 's2', userId: 'u1', deviceLabel: 'Firefox on Linux', ipAddress: '203.0.113.7', createdAt: new Date('2026-10-28T09:05:00Z') };

describe('the new-device alert', () => {
  it('emails and rings the bell for a device label the account never used', async () => {
    const { service, prisma, mail } = setup({ earlier: ['Chrome on Windows'] });
    service.afterNewSession(session);
    await flush();
    await flush();
    expect(prisma.userNotification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ key: 'new-device:s2', type: 'SECURITY', data: expect.objectContaining({ event: 'NEW_DEVICE' }) })],
      }),
    );
    expect(mail.sendNewDeviceEmail).toHaveBeenCalledWith(
      'nadia@example.com',
      'en',
      expect.objectContaining({ deviceLabel: 'Firefox on Linux', link: 'https://app.example/settings/security' }),
    );
  });

  it('stays quiet for a known device, or with the alert off', async () => {
    const known = setup({ earlier: ['Firefox on Linux'] });
    known.service.afterNewSession(session);
    const off = setup({ earlier: ['Chrome on Windows'], user: { alertNewDevice: false } });
    off.service.afterNewSession(session);
    await flush();
    await flush();
    expect(known.mail.sendNewDeviceEmail).not.toHaveBeenCalled();
    expect(off.prisma.userNotification.createMany).not.toHaveBeenCalled();
  });

  it("sends the verification email instead on a new account's first device", async () => {
    const { service, mail, verification } = setup({ user: { createdAt: new Date('2026-10-28T09:04:00Z') } });
    service.afterNewSession(session);
    await flush();
    await flush();
    expect(verification.sendAfterSignup).toHaveBeenCalledWith('u1');
    expect(mail.sendNewDeviceEmail).not.toHaveBeenCalled();
  });
});

describe('the failed-tries alert', () => {
  const client = { ipAddress: '203.0.113.7', userAgent: 'x' };

  it('claims the hour and warns at five failures', async () => {
    const { service, prisma, mail } = setup();
    service.afterFailedTry('nadia@example.com', client);
    await flush();
    await flush();
    expect(prisma.user.updateMany).toHaveBeenCalled();
    expect(mail.sendFailedTriesEmail).toHaveBeenCalledWith(
      'nadia@example.com',
      'en',
      expect.objectContaining({ count: 5, resetLink: 'https://app.example/forgot-password' }),
    );
  });

  it('does nothing below five, or when another request already claimed it', async () => {
    const few = setup({ failures: 4 });
    few.service.afterFailedTry('nadia@example.com', client);
    const lost = setup({ claimed: 0 });
    lost.service.afterFailedTry('nadia@example.com', client);
    await flush();
    await flush();
    expect(few.prisma.user.updateMany).not.toHaveBeenCalled();
    expect(lost.mail.sendFailedTriesEmail).not.toHaveBeenCalled();
    expect(lost.prisma.userNotification.createMany).not.toHaveBeenCalled();
  });

  it('rings the bell without email when Resend is not set up', async () => {
    const { service, prisma, mail } = setup({ configured: false });
    service.afterFailedTry('nadia@example.com', client);
    await flush();
    await flush();
    expect(prisma.userNotification.createMany).toHaveBeenCalled();
    expect(mail.sendFailedTriesEmail).not.toHaveBeenCalled();
  });
});
