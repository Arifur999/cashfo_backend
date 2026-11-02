import { HttpException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { totpAt, totpStep } from './totp.js';
import { TwoStepService } from './two-step.service.js';

// A small in-memory stand-in for the Prisma models TwoStepService uses:
// equality, null, {gt, lt, in, not} and OR in `where`, {increment} in data.
type Row = Record<string, unknown>;

const cmp = (a: unknown, b: unknown) => (a instanceof Date ? a.getTime() : (a as number)) - (b instanceof Date ? b.getTime() : (b as number));
const same = (a: unknown, b: unknown) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b);

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'OR') return (condition as Row[]).some((part) => matches(row, part));
    const value = row[key];
    if (condition !== null && typeof condition === 'object' && !(condition instanceof Date)) {
      const ops = condition as Row;
      if ('gt' in ops && !(value !== null && value !== undefined && cmp(value, ops.gt) > 0)) return false;
      if ('lt' in ops && !(value !== null && value !== undefined && cmp(value, ops.lt) < 0)) return false;
      if ('in' in ops && !(ops.in as unknown[]).some((option) => same(option, value))) return false;
      if ('not' in ops && same(value, ops.not)) return false;
      return true;
    }
    return condition === null ? value === null || value === undefined : same(value, condition);
  });
}

function apply(row: Row, data: Row) {
  for (const [key, value] of Object.entries(data)) {
    row[key] =
      value !== null && typeof value === 'object' && 'increment' in (value as Row) ? (row[key] as number) + ((value as Row).increment as number) : value;
  }
}

function table(defaults: (data: Row) => Row = () => ({}), key = 'id') {
  const rows: Row[] = [];
  return {
    rows,
    findUnique: vi.fn(async ({ where }: { where: Row }) => rows.find((row) => matches(row, where)) ?? null),
    findFirst: vi.fn(async ({ where }: { where: Row }) => rows.find((row) => matches(row, where)) ?? null),
    findMany: vi.fn(async ({ where }: { where?: Row } = {}) => rows.filter((row) => matches(row, where))),
    count: vi.fn(async ({ where }: { where?: Row } = {}) => rows.filter((row) => matches(row, where)).length),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row = { ...defaults(data), ...data };
      rows.push(row);
      return row;
    }),
    createMany: vi.fn(async ({ data }: { data: Row[] }) => {
      for (const item of data) rows.push({ ...defaults(item), ...item });
      return { count: data.length };
    }),
    update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
      const row = rows.find((candidate) => matches(candidate, where))!;
      apply(row, data);
      return row;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
      const hit = rows.filter((row) => matches(row, where));
      hit.forEach((row) => apply(row, data));
      return { count: hit.length };
    }),
    upsert: vi.fn(async ({ where, create, update }: { where: Row; create: Row; update: Row }) => {
      const row = rows.find((candidate) => matches(candidate, where));
      if (row) {
        apply(row, update);
        return row;
      }
      const created = { ...defaults(create), ...create };
      rows.push(created);
      return created;
    }),
    deleteMany: vi.fn(async ({ where }: { where?: Row } = {}) => {
      const keep = rows.filter((row) => !matches(row, where));
      const count = rows.length - keep.length;
      rows.splice(0, rows.length, ...keep);
      return { count };
    }),
    key,
  };
}

const fakePrisma = () => {
  const db = {
    twoFactor: table(() => ({ enabledAt: null, lastUsedStep: null, createdAt: new Date(), updatedAt: new Date() }), 'userId'),
    twoFactorBackupCode: table(() => ({ id: randomUUID(), usedAt: null, createdAt: new Date() })),
    trustedDevice: table(() => ({ id: randomUUID(), createdAt: new Date(), lastUsedAt: new Date() })),
    twoStepChallenge: table(() => ({ id: randomUUID(), attempts: 0, consumedAt: null, createdAt: new Date() })),
    loginAttempt: table(() => ({ id: randomUUID() })),
    userNotification: table(() => ({ id: randomUUID() })),
    user: table(),
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
  };
  db.user.rows.push({ id: 'user-1', email: 'nadia@example.com', emailVerified: true, name: 'Nadia', preferredLanguage: 'EN' });
  return db;
};

const setup = ({ required = false, hasPassword = true } = {}) => {
  process.env.TWO_FACTOR_ENCRYPTION_KEY = 'ab'.repeat(32);
  const prisma = fakePrisma();
  const config = { get: vi.fn(() => undefined), getOrThrow: vi.fn(() => 'jwt-secret') };
  const sessions = { revoke: vi.fn(), findActive: vi.fn() };
  const credentials = { has: vi.fn().mockResolvedValue(hasPassword), verify: vi.fn(async (_id: string, password: string) => password === 'Secret-123') };
  const settings = { getCached: vi.fn().mockResolvedValue({ adminTwoStepRequired: required }) };
  const mail = { platformName: vi.fn().mockResolvedValue('Money Tracker'), configured: false };
  const service = new TwoStepService(
    prisma as never,
    config as never,
    new JwtService({}),
    sessions as never,
    credentials as never,
    settings as never,
    mail as never,
  );
  return { service, prisma, sessions, credentials };
};

const user = { id: 'user-1', email: 'nadia@example.com' };
const client = { ipAddress: '203.0.113.7', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/129.0 Safari/537.36' };
const reauth = { password: 'Secret-123', sessionId: 's-1' };

// Turns two-step on for user-1 and returns the secret and backup codes.
const enrol = async (service: TwoStepService) => {
  const { secret } = await service.startSetup(user, 'user', reauth);
  const raw = secret.replace(/ /g, '');
  // The enabling code uses up the current step, so sign-ins below use the next one.
  const { backupCodes } = await service.enable(user.id, totpAt(raw, Date.now()));
  return { secret: raw, backupCodes };
};

const reasonOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error instanceof HttpException ? (error.getResponse() as { reason?: string; attemptsLeft?: number }) : { reason: String(error) };
  }
  return { reason: 'NONE' };
};

afterEach(() => {
  vi.useRealTimers();
});

describe('TwoStepService sign-in gate', () => {
  it('signs straight in when two-step is off', async () => {
    const { service, sessions } = setup();
    await expect(service.gate(user, 's-1', 'user')).resolves.toBeNull();
    expect(sessions.revoke).not.toHaveBeenCalled();
  });

  it('ends the first-step session and asks for the code when it is on', async () => {
    const { service, sessions } = setup();
    await enrol(service);
    const pending = await service.gate(user, 's-1', 'user');
    expect(pending).toMatchObject({ twoStepRequired: true, audience: 'user', email: 'nadia@example.com' });
    expect(sessions.revoke).toHaveBeenCalledWith('s-1');
  });

  it('asks an admin with no two-step to set it up when it is required, and leaves customers alone', async () => {
    const { service } = setup({ required: true });
    await expect(service.gate(user, 's-1', 'admin')).resolves.toMatchObject({ twoStepSetupRequired: true, audience: 'admin' });
    await expect(service.gate(user, 's-2', 'user')).resolves.toBeNull();
  });
});

describe('TwoStepService second step', () => {
  it('takes a code from the app once, and never the same code again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-27T10:00:05Z'));
    const { service, prisma } = setup();
    const { secret } = await enrol(service);
    vi.setSystemTime(new Date('2026-10-27T10:00:35Z'));
    const code = totpAt(secret, Date.now());

    const first = (await service.gate(user, 's-1', 'user')) as { challengeToken: string };
    await expect(service.answerChallenge(first.challengeToken, { code }, client)).resolves.toEqual({ userId: 'user-1', backupCodesLeft: null });
    expect(Number(prisma.twoFactor.rows[0].lastUsedStep)).toBe(totpStep(Date.now()));

    // The same code on a new sign-in, still inside its 30 seconds: refused.
    const second = (await service.gate(user, 's-2', 'user')) as { challengeToken: string };
    await expect(reasonOf(service.answerChallenge(second.challengeToken, { code }, client))).resolves.toMatchObject({ reason: 'CODE_WRONG', attemptsLeft: 4 });
    expect(prisma.loginAttempt.rows.at(-1)).toMatchObject({ success: false, failureReason: 'two_step_failed', email: 'nadia@example.com' });
  });

  it('is single use: a challenge answered once is gone', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-27T10:00:05Z'));
    const { service } = setup();
    const { secret, backupCodes } = await enrol(service);
    vi.setSystemTime(new Date('2026-10-27T10:00:35Z'));
    const { challengeToken } = (await service.gate(user, 's-1', 'user')) as { challengeToken: string };
    await service.answerChallenge(challengeToken, { code: totpAt(secret, Date.now()) }, client);
    await expect(reasonOf(service.answerChallenge(challengeToken, { backupCode: backupCodes[0] }, client))).resolves.toMatchObject({
      reason: 'CHALLENGE_EXPIRED',
    });
  });

  it('allows five tries per challenge, then refuses even the right code', async () => {
    const { service } = setup();
    const { backupCodes } = await enrol(service);
    const { challengeToken } = (await service.gate(user, 's-1', 'user')) as { challengeToken: string };
    for (let left = 4; left >= 1; left--) {
      await expect(reasonOf(service.answerChallenge(challengeToken, { code: '000000' }, client))).resolves.toMatchObject({
        reason: 'CODE_WRONG',
        attemptsLeft: left,
      });
    }
    await expect(reasonOf(service.answerChallenge(challengeToken, { code: '000000' }, client))).resolves.toMatchObject({ reason: 'TOO_MANY_ATTEMPTS' });
    await expect(reasonOf(service.answerChallenge(challengeToken, { backupCode: backupCodes[0] }, client))).resolves.toMatchObject({
      reason: 'TOO_MANY_ATTEMPTS',
    });
  });

  it('runs out after five minutes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-27T10:00:00Z'));
    const { service } = setup();
    const { backupCodes } = await enrol(service);
    const { challengeToken } = (await service.gate(user, 's-1', 'user')) as { challengeToken: string };
    vi.setSystemTime(new Date('2026-10-27T10:05:01Z'));
    await expect(reasonOf(service.answerChallenge(challengeToken, { backupCode: backupCodes[0] }, client))).resolves.toMatchObject({
      reason: 'CHALLENGE_EXPIRED',
    });
  });

  it('does not take a set-up token as a sign-in challenge, nor a forged one', async () => {
    const { service } = setup({ required: true });
    const { setupToken } = (await service.gate(user, 's-1', 'admin')) as { setupToken: string };
    await expect(reasonOf(service.answerChallenge(setupToken, { code: '123456' }, client))).resolves.toMatchObject({ reason: 'CHALLENGE_EXPIRED' });
    const forged = new JwtService({}).sign({ sub: 'user-1', purpose: 'SIGN_IN' }, { secret: 'not-ours', audience: 'two-step', jwtid: 'x' });
    await expect(reasonOf(service.answerChallenge(forged, { code: '123456' }, client))).resolves.toMatchObject({ reason: 'CHALLENGE_EXPIRED' });
  });

  it('takes each backup code once and says how many are left', async () => {
    const { service } = setup();
    const { backupCodes } = await enrol(service);
    const first = (await service.gate(user, 's-1', 'user')) as { challengeToken: string };
    await expect(service.answerChallenge(first.challengeToken, { backupCode: backupCodes[3].toUpperCase() }, client)).resolves.toEqual({
      userId: 'user-1',
      backupCodesLeft: 9,
    });
    const second = (await service.gate(user, 's-2', 'user')) as { challengeToken: string };
    await expect(reasonOf(service.answerChallenge(second.challengeToken, { backupCode: backupCodes[3] }, client))).resolves.toMatchObject({
      reason: 'BACKUP_CODE_WRONG',
    });
  });
});

describe('TwoStepService trusted computers', () => {
  it('skips the code on a trusted computer for 30 days, then asks again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-27T10:00:00Z'));
    const { service, prisma } = setup();
    await enrol(service);
    const { token, expiresAt } = await service.trustDevice(user.id, client);
    expect(expiresAt.toISOString()).toBe('2026-11-26T10:00:00.000Z');
    expect(prisma.trustedDevice.rows[0].tokenHash).not.toBe(token);

    await expect(service.gate(user, 's-1', 'user', `other-${'x'.repeat(30)},${token}`)).resolves.toBeNull();
    vi.setSystemTime(new Date('2026-11-26T10:00:01Z'));
    await expect(service.gate(user, 's-2', 'user', token)).resolves.toMatchObject({ twoStepRequired: true });
  });

  it("does not let one account's trusted token skip another account's code", async () => {
    const { service, prisma } = setup();
    await enrol(service);
    prisma.trustedDevice.rows.push({ id: 'd', userId: 'someone-else', tokenHash: 'h', expiresAt: new Date(Date.now() + 1e9) });
    const { token } = await service.trustDevice('someone-else', client);
    await expect(service.gate(user, 's-1', 'user', token)).resolves.toMatchObject({ twoStepRequired: true });
  });

  it('lists trusted computers and marks this one', async () => {
    const { service } = setup();
    await enrol(service);
    const { token } = await service.trustDevice(user.id, client);
    await service.trustDevice(user.id, { ipAddress: '198.51.100.2', userAgent: 'Safari' });
    const status = await service.status(user.id, 'user', token);
    expect(status).toMatchObject({ enabled: true, backupCodesLeft: 10 });
    expect(status.trustedDevices.filter((device) => device.current)).toHaveLength(1);
    expect(status.trustedDevices.find((device) => device.current)?.deviceLabel).toBe('Chrome on Windows');
  });
});

describe('TwoStepService set-up and turning off', () => {
  it('turns on only with a right code from the new secret, and stores it sealed', async () => {
    const { service, prisma } = setup();
    const { secret, otpauthUrl } = await service.startSetup(user, 'user', reauth);
    expect(otpauthUrl).toContain('otpauth://totp/Money%20Tracker:nadia%40example.com?secret=');
    expect(prisma.twoFactor.rows[0].secretCiphertext).not.toContain(secret.replace(/ /g, ''));
    await expect(reasonOf(service.enable(user.id, '000000'))).resolves.toMatchObject({ reason: 'CODE_WRONG' });
    expect(await service.isEnabled(user.id)).toBe(false);
    const { backupCodes } = await service.enable(user.id, totpAt(secret.replace(/ /g, ''), Date.now()));
    expect(backupCodes).toHaveLength(10);
    expect(prisma.twoFactorBackupCode.rows.every((row) => !backupCodes.includes(row.codeHash as string))).toBe(true);
  });

  it('needs a verified email before a customer can turn it on', async () => {
    const { service, prisma } = setup();
    (prisma as unknown as { user: { rows: Record<string, unknown>[] } }).user.rows[0].emailVerified = false;
    await expect(service.startSetup(user, 'user', reauth)).rejects.toMatchObject({ response: { reason: 'EMAIL_NOT_VERIFIED' } });
  });

  it('wants the password before showing a new secret', async () => {
    const { service } = setup();
    await expect(service.startSetup(user, 'user', { password: 'wrong', sessionId: 's-1' })).rejects.toThrow('Your password is incorrect.');
  });

  it('takes a recent sign-in instead of a password for a Google-only account', async () => {
    const { service, sessions } = setup({ hasPassword: false });
    sessions.findActive.mockResolvedValue({ createdAt: new Date(Date.now() - 11 * 60 * 1000) });
    await expect(reasonOf(service.startSetup(user, 'user', { sessionId: 's-1' }))).resolves.toMatchObject({ reason: 'RECENT_SIGN_IN_REQUIRED' });
    sessions.findActive.mockResolvedValue({ createdAt: new Date() });
    await expect(service.startSetup(user, 'user', { sessionId: 's-1' })).resolves.toHaveProperty('otpauthUrl');
  });

  it('turns off with the password and a backup code, removing codes and trusted computers', async () => {
    const { service, prisma } = setup();
    const { backupCodes } = await enrol(service);
    await service.trustDevice(user.id, client);
    await service.disable(user.id, 'user', reauth, { backupCode: backupCodes[0] });
    expect(prisma.twoFactor.rows).toHaveLength(0);
    expect(prisma.twoFactorBackupCode.rows).toHaveLength(0);
    expect(prisma.trustedDevice.rows).toHaveLength(0);
  });

  it('does not let an admin turn it off while it is required for every admin', async () => {
    const { service } = setup({ required: true });
    const { backupCodes } = await enrol(service);
    await expect(service.disable(user.id, 'admin', reauth, { backupCode: backupCodes[0] })).rejects.toThrow('required for every admin');
  });

  it('enables during an admin sign-in with the set-up token, once', async () => {
    const { service } = setup({ required: true });
    const { setupToken } = (await service.gate(user, 's-1', 'admin')) as { setupToken: string };
    expect(await service.setupTokenOwner(setupToken)).toBe('user-1');
    const { secret } = await service.startSetup(user, 'admin', null);
    const code = totpAt(secret.replace(/ /g, ''), Date.now());
    await expect(service.enableWithSetupToken(setupToken, code)).resolves.toMatchObject({ userId: 'user-1' });
    await expect(reasonOf(service.setupTokenOwner(setupToken))).resolves.toMatchObject({ reason: 'CHALLENGE_EXPIRED' });
  });

  it('tidies up old challenges, expired trusted computers and abandoned set-ups', async () => {
    const { service, prisma } = setup();
    const now = new Date();
    prisma.twoStepChallenge.rows.push(
      { id: 'old', expiresAt: new Date(now.getTime() - 2 * 86400000) },
      { id: 'live', expiresAt: new Date(now.getTime() + 60000) },
    );
    prisma.trustedDevice.rows.push({ id: 'gone', expiresAt: new Date(now.getTime() - 1) }, { id: 'kept', expiresAt: new Date(now.getTime() + 1) });
    prisma.twoFactor.rows.push({ userId: 'abandoned', enabledAt: null, updatedAt: new Date(now.getTime() - 2 * 86400000) });
    await service.cleanup(now);
    expect(prisma.twoStepChallenge.rows.map((row) => row.id)).toEqual(['live']);
    expect(prisma.trustedDevice.rows.map((row) => row.id)).toEqual(['kept']);
    expect(prisma.twoFactor.rows).toHaveLength(0);
  });
});
