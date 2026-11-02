import { HttpException } from '@nestjs/common';
import { codeMatches, generateCode, hashCode, resendAfterSec, resendGapMs, resendProblem, verifyProblem, type CodeState } from './one-time-codes.js';
import { OneTimeCodesService } from './one-time-codes.service.js';

const NOW = new Date('2026-10-01T05:20:00.000Z');
const state = (over: Partial<CodeState> = {}): CodeState => ({
  attempts: 0,
  sends: 1,
  expiresAt: new Date(NOW.getTime() + 10 * 60 * 1000),
  consumedAt: null,
  lastSentAt: NOW,
  ...over,
});

describe('one-time code rules', () => {
  it('makes six digits and keeps only a salted hash', () => {
    for (let i = 0; i < 50; i++) expect(generateCode()).toMatch(/^\d{6}$/);
    expect(hashCode('481527', 'a')).not.toBe(hashCode('481527', 'b'));
    expect(codeMatches('481527', 'a', hashCode('481527', 'a'))).toBe(true);
    expect(codeMatches('481528', 'a', hashCode('481527', 'a'))).toBe(false);
  });

  it('refuses a used, expired or over-tried code', () => {
    expect(verifyProblem(state(), NOW)).toBeNull();
    expect(verifyProblem(state({ consumedAt: NOW }), NOW)).toBe('CODE_USED');
    expect(verifyProblem(state(), new Date(NOW.getTime() + 10 * 60 * 1000))).toBe('CODE_EXPIRED');
    expect(verifyProblem(state({ attempts: 4 }), NOW)).toBeNull();
    expect(verifyProblem(state({ attempts: 5 }), NOW)).toBe('TOO_MANY_ATTEMPTS');
  });

  it('sends again only after a minute, at most five times', () => {
    expect(resendProblem(state(), new Date(NOW.getTime() + 30_000))).toBe('RESEND_TOO_SOON');
    expect(resendAfterSec(NOW, new Date(NOW.getTime() + 18_000))).toBe(42);
    expect(resendProblem(state(), new Date(NOW.getTime() + 60_000))).toBeNull();
    expect(resendProblem(state({ sends: 5 }), new Date(NOW.getTime() + 60_000))).toBe('TOO_MANY_SENDS');
  });

  it("sends the vault's unlock code again after half a minute", () => {
    const gap = resendGapMs('VAULT_UNLOCK');
    expect(gap).toBe(30_000);
    expect(resendGapMs('PAYOUT_REQUEST')).toBe(60_000);
    expect(resendProblem(state(), new Date(NOW.getTime() + 29_000), gap)).toBe('RESEND_TOO_SOON');
    expect(resendProblem(state(), new Date(NOW.getTime() + 30_000), gap)).toBeNull();
    expect(resendAfterSec(NOW, new Date(NOW.getTime() + 18_000), gap)).toBe(12);
  });
});

const person = { id: 'u-1', name: 'Khaled', email: 'khaled@gmail.com', phone: '01711482915', preferredLanguage: 'EN' };

const setup = ({ route = true as boolean, row = null as Record<string, unknown> | null, claimed = 1 } = {}) => {
  const sender = { channel: 'EMAIL', send: vi.fn().mockResolvedValue(undefined) };
  const prisma = {
    oneTimeCode: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn((args: { data: Record<string, unknown> }) => Promise.resolve({ attempts: 0, sends: 1, ...args.data })),
      delete: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn().mockResolvedValue(row),
      updateMany: vi.fn().mockResolvedValue({ count: claimed }),
    },
  };
  const senders = { pick: vi.fn().mockReturnValue(route ? { sender, destination: person.email } : null), forChannel: vi.fn().mockReturnValue(sender) };
  return { service: new OneTimeCodesService(prisma as never, senders as never), prisma, sender };
};

const reasonOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return { status: (error as HttpException).getStatus(), body: (error as HttpException).getResponse() as Record<string, unknown> };
  }
  throw new Error('expected a refusal');
};

describe('OneTimeCodesService', () => {
  it('sends a code by email, replacing an unused one, and says where it went', async () => {
    const { service, prisma, sender } = setup();
    const challenge = await service.issue(person, 'PAYOUT_REQUEST', { amount: '1000.00' }, { en: 'withdraw', bn: 'তোলা' });
    expect(prisma.oneTimeCode.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u-1', purpose: 'PAYOUT_REQUEST', consumedAt: null } });
    const code = sender.send.mock.calls[0][1] as string;
    expect(code).toMatch(/^\d{6}$/);
    const stored = prisma.oneTimeCode.create.mock.calls[0][0].data as { id: string; codeHash: string };
    expect(stored.codeHash).toBe(hashCode(code, stored.id));
    expect(challenge).toMatchObject({ channel: 'EMAIL', sentTo: 'k***@gmail.com', resendAfterSec: 60, attemptsLeft: 5, sendsLeft: 4 });
  });

  it('answers 503 EMAIL_NOT_CONFIGURED when nothing can send it', async () => {
    const { service } = setup({ route: false });
    const refusal = await reasonOf(service.issue(person, 'PAYOUT_REQUEST', {}, { en: 'x', bn: 'x' }));
    expect(refusal.status).toBe(503);
    expect(refusal.body.reason).toBe('EMAIL_NOT_CONFIGURED');
  });

  it('counts a wrong code and says how many tries are left', async () => {
    const row = { id: 'c-1', ...state({ attempts: 1 }), expiresAt: new Date(Date.now() + 60_000), lastSentAt: new Date(), codeHash: hashCode('111111', 'c-1') };
    const { service, prisma } = setup({ row });
    const refusal = await reasonOf(service.verify('u-1', 'c-1', 'PAYOUT_REQUEST', '222222'));
    expect(prisma.oneTimeCode.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { attempts: { increment: 1 } } }));
    expect(refusal.body).toMatchObject({ reason: 'CODE_WRONG', attemptsLeft: 3 });
  });

  it('accepts the right code', async () => {
    const row = {
      id: 'c-1',
      ...state(),
      expiresAt: new Date(Date.now() + 60_000),
      lastSentAt: new Date(),
      codeHash: hashCode('111111', 'c-1'),
      payload: { amount: '1000.00' },
    };
    const { service } = setup({ row });
    await expect(service.verify('u-1', 'c-1', 'PAYOUT_REQUEST', '111111')).resolves.toMatchObject({ payload: { amount: '1000.00' } });
  });

  it('refuses an expired code without counting a try', async () => {
    const row = { id: 'c-1', ...state(), expiresAt: new Date(Date.now() - 1000), lastSentAt: new Date(), codeHash: hashCode('111111', 'c-1') };
    const { service, prisma } = setup({ row });
    expect((await reasonOf(service.verify('u-1', 'c-1', 'PAYOUT_REQUEST', '111111'))).body.reason).toBe('CODE_EXPIRED');
    expect(prisma.oneTimeCode.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a fifth wrong try that lost the race for the last attempt', async () => {
    const row = { id: 'c-1', ...state({ attempts: 4 }), expiresAt: new Date(Date.now() + 60_000), lastSentAt: new Date(), codeHash: hashCode('111111', 'c-1') };
    const { service } = setup({ row, claimed: 0 });
    expect((await reasonOf(service.verify('u-1', 'c-1', 'PAYOUT_REQUEST', '111111'))).body.reason).toBe('TOO_MANY_ATTEMPTS');
  });

  it('answers 404 for someone else’s challenge', async () => {
    const { service } = setup({ row: null });
    expect((await reasonOf(service.verify('u-2', 'c-1', 'PAYOUT_REQUEST', '111111'))).status).toBe(404);
  });

  it('makes the resend wait a minute', async () => {
    const row = { id: 'c-1', channel: 'EMAIL', destination: 'khaled@gmail.com', ...state(), lastSentAt: new Date(Date.now() - 20_000) };
    const { service } = setup({ row });
    const refusal = await reasonOf(service.resend(person, 'c-1', 'PAYOUT_REQUEST', { en: 'x', bn: 'x' }));
    expect(refusal.status).toBe(429);
    expect(refusal.body.reason).toBe('RESEND_TOO_SOON');
  });
});

describe('OneTimeCodesService for the vault', () => {
  const routes = (first: { send: ReturnType<typeof vi.fn> }, second: { send: ReturnType<typeof vi.fn> }) => [
    { sender: { channel: 'EMAIL', ...first }, destination: 'khaled@gmail.com' },
    { sender: { channel: 'SMS', ...second }, destination: '01711482915' },
  ];
  const vaultSetup = (list: ReturnType<typeof routes>) => {
    const prisma = {
      oneTimeCode: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn((args: { data: Record<string, unknown> }) => Promise.resolve({ attempts: 0, sends: 1, ...args.data })),
        update: vi.fn().mockResolvedValue({}),
        findUniqueOrThrow: vi.fn((args: { where: { id: string } }) => Promise.resolve({ id: args.where.id, attempts: 0, sends: 1, channel: 'SMS', destination: '01711482915', lastSentAt: new Date(), expiresAt: new Date(Date.now() + 600_000) })),
        delete: vi.fn().mockResolvedValue({}),
      },
    };
    const senders = { emailFirst: vi.fn().mockReturnValue(list) };
    return { service: new OneTimeCodesService(prisma as never, senders as never), prisma };
  };
  const sameSignIn = { payload: { path: ['sessionId'], equals: 's1' } };

  it("replaces only this sign-in's waiting code", async () => {
    const ok = { send: vi.fn().mockResolvedValue(undefined) };
    const { service, prisma } = vaultSetup(routes(ok, ok));
    await service.issue(person, 'VAULT_UNLOCK', { sessionId: 's1' }, { en: 'x', bn: 'x' }, { emailFirst: true, replace: sameSignIn });
    expect(prisma.oneTimeCode.deleteMany).toHaveBeenCalledWith({ where: { ...sameSignIn, userId: 'u-1', purpose: 'VAULT_UNLOCK', consumedAt: null } });
  });

  it('falls back to the phone when the email cannot go', async () => {
    const failing = { send: vi.fn().mockRejectedValue(new Error('mail down')) };
    const sms = { send: vi.fn().mockResolvedValue(undefined) };
    const { service, prisma } = vaultSetup(routes(failing, sms));
    const challenge = await service.issue(person, 'VAULT_UNLOCK', {}, { en: 'x', bn: 'x' }, { emailFirst: true });
    expect(sms.send).toHaveBeenCalled();
    expect(prisma.oneTimeCode.update).toHaveBeenCalledWith(expect.objectContaining({ data: { channel: 'SMS', destination: '01711482915' } }));
    expect(challenge.channel).toBe('SMS');
  });

  it('answers 503 CODE_NOT_SENT when no way works, keeping no code', async () => {
    const failing = { send: vi.fn().mockRejectedValue(new Error('down')) };
    const { service, prisma } = vaultSetup(routes(failing, failing));
    const refusal = await reasonOf(service.issue(person, 'VAULT_UNLOCK', {}, { en: 'x', bn: 'x' }, { emailFirst: true }));
    expect(refusal.body.reason).toBe('CODE_NOT_SENT');
    expect(prisma.oneTimeCode.delete).toHaveBeenCalled();
  });

  it('answers a waiting code as it is inside the resend wait, and null once it is spent', async () => {
    const { service } = vaultSetup([]);
    const fresh = { id: 'c-1', purpose: 'VAULT_UNLOCK', channel: 'EMAIL', destination: 'khaled@gmail.com', ...state(), lastSentAt: new Date(), expiresAt: new Date(Date.now() + 600_000) };
    await expect(service.again(person, fresh as never, { en: 'x', bn: 'x' })).resolves.toMatchObject({ challengeId: 'c-1' });
    await expect(service.again(person, { ...fresh, attempts: 5 } as never, { en: 'x', bn: 'x' })).resolves.toBeNull();
  });
});
