import { testPush } from './push-payload.js';
import { allows, defaultPrefs } from '../notification-prefs/notification-prefs.js';
import { PushService } from './push.service.js';

const webpush = vi.hoisted(() => ({ setVapidDetails: vi.fn(), sendNotification: vi.fn() }));
vi.mock('web-push', () => ({ default: webpush }));

const device = (id: string, locale = 'en') => ({ id, userId: 'u1', endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, p256dh: 'p', auth: 'a', locale });

const setup = (subscriptions = [device('d1')], vapid = true) => {
  const prisma = {
    pushSubscription: {
      findMany: vi.fn().mockResolvedValue(subscriptions),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      upsert: vi.fn().mockResolvedValue({}),
    },
  };
  vi.stubEnv('VAPID_PUBLIC_KEY', vapid ? 'pub' : undefined);
  vi.stubEnv('VAPID_PRIVATE_KEY', vapid ? 'priv' : undefined);
  vi.stubEnv('VAPID_SUBJECT', vapid ? 'mailto:support@example.com' : undefined);
  // Everyone on the defaults, on Free.
  const prefs = { forUsers: vi.fn().mockResolvedValue(new Map()), allowed: (_entry: unknown, alert: string, channel: string) => allows(defaultPrefs(), alert, channel as 'push', { pro: false, dhakaClock: '12:00' }) };
  const service = new PushService(prisma as never, prefs as never);
  service.onModuleInit();
  return { service, prisma };
};

beforeEach(() => {
  webpush.setVapidDetails.mockReset();
  webpush.sendNotification.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('PushService', () => {
  it('is off, with a null key, when the VAPID keys are not set', async () => {
    const { service, prisma } = setup([device('d1')], false);
    expect(service.publicKey()).toEqual({ publicKey: null });
    expect(await service.sendTest('u1')).toEqual({ sent: 0 });
    expect(prisma.pushSubscription.findMany).not.toHaveBeenCalled();
  });

  it("sends each device its own language, for half an hour, and notes it's in use", async () => {
    webpush.sendNotification.mockResolvedValue({ statusCode: 201 });
    const { service, prisma } = setup([device('d1', 'bn'), device('d2', 'en')]);
    expect(service.publicKey()).toEqual({ publicKey: 'pub' });
    expect(await service.sendTest('u1')).toEqual({ sent: 2 });

    const [first, second] = webpush.sendNotification.mock.calls;
    expect(JSON.parse(first[1])).toEqual(testPush('bn'));
    expect(JSON.parse(second[1])).toEqual(testPush('en'));
    expect(first[2]).toEqual({ TTL: 1800, urgency: 'high' });
    expect(prisma.pushSubscription.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['d1', 'd2'] } }, data: { lastUsedAt: expect.any(Date) } });
  });

  it('forgets a device the push service no longer knows, and never throws', async () => {
    webpush.sendNotification.mockRejectedValueOnce(Object.assign(new Error('Gone'), { statusCode: 410 })).mockRejectedValueOnce(new Error('timeout'));
    const { service, prisma } = setup([device('d1'), device('d2')]);
    expect(await service.sendTest('u1')).toEqual({ sent: 0 });
    expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['d1'] } } });
    expect(prisma.pushSubscription.updateMany).not.toHaveBeenCalled();

    prisma.pushSubscription.findMany.mockRejectedValueOnce(new Error('database down'));
    await expect(service.send([{ userId: 'u1', build: testPush }])).resolves.toBe(0);
  });

  it("moves a device to whoever subscribes on it now, and only deletes the caller's own", async () => {
    const { service, prisma } = setup([]);
    const endpoint = 'https://fcm.googleapis.com/fcm/send/d9';
    await expect(service.subscribe('u2', { endpoint, keys: { p256dh: 'p', auth: 'a' }, locale: 'bn' }, 'Mozilla/5.0')).resolves.toEqual({ ok: true });
    const fields = { userId: 'u2', p256dh: 'p', auth: 'a', locale: 'bn', userAgent: 'Mozilla/5.0', lastUsedAt: expect.any(Date) };
    expect(prisma.pushSubscription.upsert).toHaveBeenCalledWith({ where: { endpoint }, create: { endpoint, ...fields }, update: fields });

    await service.unsubscribe('u2', endpoint);
    expect(prisma.pushSubscription.deleteMany).toHaveBeenLastCalledWith({ where: { userId: 'u2', endpoint } });
  });
});
