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
    $executeRaw: vi.fn(),
    $transaction: vi.fn((work: (tx: unknown) => unknown) => work(prisma)),
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
  const route = (channel: 'EMAIL' | 'SMS', send: ReturnType<typeof vi.fn>) => ({ sender: { channel, send }, destination: channel === 'SMS' ? '01711482915' : 'khaled@gmail.com' });
  const ok = () => vi.fn().mockResolvedValue(undefined);
  const down = () => vi.fn().mockRejectedValue(new Error('down'));
  const vaultSetup = (routes: ReturnType<typeof route>[], waiting: Record<string, unknown> | null = null) => {
    const prisma = {
      oneTimeCode: {
        findFirst: vi.fn().mockResolvedValue(waiting),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn((args: { data: Record<string, unknown> }) => Promise.resolve({ attempts: 0, sends: 1, ...args.data })),
        update: vi.fn((args: { where: { id: string }; data: Record<string, unknown> }) => Promise.resolve({ ...waiting, ...args.data, sends: 2 })),
      },
      $executeRaw: vi.fn(),
      $transaction: vi.fn((work: (tx: unknown) => unknown) => work(prisma)),
    };
    const senders = { emailFirst: vi.fn().mockReturnValue(routes) };
    return { service: new OneTimeCodesService(prisma as never, senders as never), prisma };
  };
  const sameSignIn = { payload: { path: ['sessionId'], equals: 's1' } };
  const waitingCode = (over: Partial<CodeState> = {}) => ({ id: 'c-1', purpose: 'VAULT_UNLOCK', channel: 'EMAIL', destination: 'khaled@gmail.com', codeHash: 'old', ...state(over), lastSentAt: over.lastSentAt ?? new Date(), expiresAt: new Date(Date.now() + 600_000) });
  const action = { en: 'x', bn: 'x' };

  it("sends first, then keeps the code in place of only this sign-in's waiting one, under the person's lock", async () => {
    const send = ok();
    const { service, prisma } = vaultSetup([route('EMAIL', send)]);
    await service.issue(person, 'VAULT_UNLOCK', { sessionId: 's1' }, action, { emailFirst: true, replace: sameSignIn });
    expect(prisma.$executeRaw).toHaveBeenCalled();
    expect(prisma.oneTimeCode.deleteMany).toHaveBeenCalledWith({ where: { ...sameSignIn, userId: 'u-1', purpose: 'VAULT_UNLOCK', consumedAt: null } });
    expect(send.mock.invocationCallOrder[0]).toBeLessThan(prisma.oneTimeCode.create.mock.invocationCallOrder[0]);
  });

  it('falls back to the phone when the email cannot go, and keeps the way that worked', async () => {
    const sms = ok();
    const { service, prisma } = vaultSetup([route('EMAIL', down()), route('SMS', sms)]);
    const challenge = await service.issue(person, 'VAULT_UNLOCK', {}, action, { emailFirst: true });
    expect(sms).toHaveBeenCalled();
    expect(prisma.oneTimeCode.create.mock.calls[0][0].data).toMatchObject({ channel: 'SMS', destination: '01711482915' });
    expect(challenge.channel).toBe('SMS');
  });

  it('answers 503 CODE_NOT_SENT when no way works, keeping and replacing nothing', async () => {
    const { service, prisma } = vaultSetup([route('EMAIL', down()), route('SMS', down())]);
    const refusal = await reasonOf(service.issue(person, 'VAULT_UNLOCK', {}, action, { emailFirst: true }));
    expect(refusal.body.reason).toBe('CODE_NOT_SENT');
    expect(prisma.oneTimeCode.deleteMany).not.toHaveBeenCalled();
    expect(prisma.oneTimeCode.create).not.toHaveBeenCalled();
  });

  it('answers the waiting code as it is inside the resend wait, and after five sends', async () => {
    for (const waiting of [waitingCode(), waitingCode({ sends: 5, lastSentAt: new Date(Date.now() - 120_000) })]) {
      const send = ok();
      const { service, prisma } = vaultSetup([route('EMAIL', send)], waiting);
      await expect(service.issueOrReuse(person, 'VAULT_UNLOCK', {}, action, { emailFirst: true, replace: sameSignIn })).resolves.toMatchObject({ challengeId: 'c-1' });
      expect(send).not.toHaveBeenCalled();
      expect(prisma.oneTimeCode.create).not.toHaveBeenCalled();
    }
  });

  it('sends the waiting code again after the wait, the phone when the email stopped working', async () => {
    const sms = ok();
    const { service, prisma } = vaultSetup([route('EMAIL', down()), route('SMS', sms)], waitingCode({ lastSentAt: new Date(Date.now() - 31_000) }));
    await expect(service.issueOrReuse(person, 'VAULT_UNLOCK', {}, action, { emailFirst: true, replace: sameSignIn })).resolves.toMatchObject({ challengeId: 'c-1', channel: 'SMS' });
    expect(prisma.oneTimeCode.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ channel: 'SMS', sends: { increment: 1 } }) }));
  });

  it('keeps the old code working when a resend cannot go', async () => {
    const { service, prisma } = vaultSetup([route('EMAIL', down())], waitingCode({ lastSentAt: new Date(Date.now() - 31_000) }));
    expect((await reasonOf(service.issueOrReuse(person, 'VAULT_UNLOCK', {}, action, { emailFirst: true }))).body.reason).toBe('CODE_NOT_SENT');
    expect(prisma.oneTimeCode.update).not.toHaveBeenCalled();
  });

  it('issues a new code when the waiting one took its five tries, or is not theirs', async () => {
    const send = ok();
    const spent = vaultSetup([route('EMAIL', send)], waitingCode({ attempts: 5 }));
    await spent.service.issueOrReuse(person, 'VAULT_UNLOCK', {}, action, { emailFirst: true });
    expect(spent.prisma.oneTimeCode.create).toHaveBeenCalled();

    const other = vaultSetup([route('EMAIL', ok())], waitingCode());
    await other.service.issueOrReuse(person, 'VAULT_UNLOCK', {}, action, { emailFirst: true, belongs: () => false });
    expect(other.prisma.oneTimeCode.create).toHaveBeenCalled();
  });

  it('refuses to send again a challenge that is not theirs', async () => {
    const { service } = vaultSetup([route('EMAIL', ok())]);
    const prismaRow = waitingCode({ lastSentAt: new Date(Date.now() - 31_000) });
    (service as unknown as { prisma: { oneTimeCode: { findFirst: ReturnType<typeof vi.fn> } } }).prisma.oneTimeCode.findFirst.mockResolvedValue(prismaRow);
    expect((await reasonOf(service.resend(person, 'c-1', 'VAULT_UNLOCK', action, { belongs: () => false }))).body.reason).toBe('CHALLENGE_NOT_FOUND');
  });

  it('answers a wrong code without throwing, for the caller to count', async () => {
    const row = { id: 'c-1', ...state({ attempts: 1 }), expiresAt: new Date(Date.now() + 60_000), lastSentAt: new Date(), codeHash: hashCode('111111', 'c-1') };
    const { service } = setup({ row });
    await expect(service.check('u-1', 'c-1', 'VAULT_UNLOCK', '222222')).resolves.toEqual({ ok: false, attemptsLeft: 3 });
    await expect(service.check('u-1', 'c-1', 'VAULT_UNLOCK', '111111')).resolves.toMatchObject({ ok: true, row: { id: 'c-1' } });
  });
});
