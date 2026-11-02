import * as bcrypt from 'bcrypt';
import { PasswordVaultService } from './password-vault.service.js';
import { vaultPasswordFingerprint } from './vault-crypto.js';

const HASH = bcrypt.hashSync('mango tree 42', 4);
const VER = vaultPasswordFingerprint(HASH);
const user = { id: 'u1', sessionId: 's1' } as never;
const CHALLENGE = { challengeId: 'c1', channel: 'EMAIL', sentTo: 'k***@example.com', resendAfterSec: 30, attemptsLeft: 5, sendsLeft: 4 };

const person = (over: Record<string, unknown> = {}) => ({
  id: 'u1',
  name: 'Khaled Mahmud',
  email: 'khaled@example.com',
  emailVerified: true,
  phone: '01711482915',
  phoneVerifiedAt: null,
  preferredLanguage: 'EN',
  vaultPasswordHash: HASH,
  vaultLockMinutes: null,
  vaultUnlockFailures: 0,
  vaultUnlockFailedAt: null,
  ...over,
});

const setup = (config: Record<string, string> = {}) => {
  const prisma = {
    user: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(person()),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const jwt = { sign: vi.fn().mockReturnValue('vault-token') };
  const settings: Record<string, string> = { VAULT_TOKEN_EXPIRES_IN: '10m', VAULT_TOKEN_SECRET: 'secret', ...config };
  const configService = { get: vi.fn((key: string) => settings[key]) };
  const codes = {
    issue: vi.fn().mockResolvedValue(CHALLENGE),
    pending: vi.fn().mockResolvedValue(null),
    again: vi.fn(),
    peek: vi.fn(),
    resend: vi.fn().mockResolvedValue(CHALLENGE),
    verify: vi.fn(),
    consume: vi.fn().mockResolvedValue(true),
  };
  const credentials = { verify: vi.fn().mockImplementation((_id: string, password: string) => Promise.resolve(password === 'login pass 1')), has: vi.fn().mockResolvedValue(true) };
  const service = new PasswordVaultService(prisma as never, jwt as never, configService as never, credentials as never, {} as never, codes as never);
  return { service, codes, jwt, prisma };
};

describe('PasswordVaultService two-step unlock', () => {
  it('answers the right vault password with a code for this sign-in, by email first, not a vault token', async () => {
    const { service, codes, jwt, prisma } = setup();

    const answer = await service.unlock(user, { vaultPassword: 'mango tree 42' });

    expect(answer).toMatchObject({ codeRequired: true, challengeId: 'c1' });
    expect(answer).not.toHaveProperty('vaultToken');
    expect(jwt.sign).not.toHaveBeenCalled();
    expect(codes.issue).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1', email: 'khaled@example.com' }), 'VAULT_UNLOCK', { sessionId: 's1', ver: VER }, expect.objectContaining({ en: 'open your Password Manager' }), {
      emailFirst: true,
      replace: { payload: { path: ['sessionId'], equals: 's1' } },
    });
    // The right password alone doesn't clear the wrong tries: only the code does.
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("answers this sign-in's code still waiting instead of emailing a new one", async () => {
    const { service, codes } = setup();
    const row = { id: 'c1', payload: { sessionId: 's1', ver: VER }, sends: 1, lastSentAt: new Date(), expiresAt: new Date(Date.now() + 600_000) };
    codes.pending.mockResolvedValue(row);
    codes.again.mockResolvedValue(CHALLENGE);

    await expect(service.unlock(user, { vaultPassword: 'mango tree 42' })).resolves.toMatchObject({ codeRequired: true, challengeId: 'c1' });
    expect(codes.pending).toHaveBeenCalledWith('u1', 'VAULT_UNLOCK', { payload: { path: ['sessionId'], equals: 's1' } }, expect.any(Date));
    expect(codes.again).toHaveBeenCalledWith(expect.anything(), row, expect.anything(), expect.any(Date));
    expect(codes.issue).not.toHaveBeenCalled();
  });

  it('stops emailing once the waiting code was sent five times', async () => {
    const { service, codes } = setup();
    codes.pending.mockResolvedValue({ id: 'c1', payload: { sessionId: 's1', ver: VER }, sends: 5, lastSentAt: new Date(), expiresAt: new Date(Date.now() + 300_000) });

    await expect(service.unlock(user, { vaultPassword: 'mango tree 42' })).rejects.toMatchObject({ response: { reason: 'TOO_MANY_SENDS' } });
    expect(codes.again).not.toHaveBeenCalled();
    expect(codes.issue).not.toHaveBeenCalled();
  });

  it('opens with the password alone when VAULT_UNLOCK_CODE is off', async () => {
    const { service, codes } = setup({ VAULT_UNLOCK_CODE: 'off' });
    await expect(service.unlock(user, { vaultPassword: 'mango tree 42' })).resolves.toMatchObject({ vaultToken: 'vault-token' });
    expect(codes.issue).not.toHaveBeenCalled();
  });

  it('opens the vault with the code from the same sign-in and clears the wrong tries', async () => {
    const { service, codes, jwt, prisma } = setup();
    prisma.user.findUniqueOrThrow.mockResolvedValue(person({ vaultUnlockFailures: 3, vaultUnlockFailedAt: new Date() }));
    codes.verify.mockResolvedValue({ id: 'c1', payload: { sessionId: 's1', ver: VER } });

    await expect(service.verifyUnlock(user, { challengeId: 'c1', code: '284913' })).resolves.toMatchObject({ vaultToken: 'vault-token', expiresInSec: 600 });
    expect(codes.verify).toHaveBeenCalledWith('u1', 'c1', 'VAULT_UNLOCK', '284913');
    expect(codes.consume).toHaveBeenCalled();
    expect(jwt.sign).toHaveBeenCalledWith({ sub: 'u1', scope: 'vault', ver: VER }, expect.anything());
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { vaultUnlockFailures: 0, vaultUnlockFailedAt: null } });
  });

  it("counts a wrong code as one of the person's ten tries, then locks out", async () => {
    const { HttpException } = await import('@nestjs/common');
    const { service, codes, prisma } = setup();
    codes.verify.mockRejectedValue(new HttpException({ statusCode: 400, message: 'That code is not right.', reason: 'CODE_WRONG', attemptsLeft: 4 }, 400));

    // Two tries left for the person: the code's four are cut to two.
    prisma.user.findUniqueOrThrow.mockResolvedValueOnce(person()).mockResolvedValueOnce({ vaultUnlockFailures: 8, vaultUnlockFailedAt: new Date() });
    await expect(service.verifyUnlock(user, { challengeId: 'c1', code: '000000' })).rejects.toMatchObject({ response: { reason: 'CODE_WRONG', attemptsLeft: 2, triesLeft: 2 } });
    expect(prisma.user.updateMany).toHaveBeenCalled();

    // The tenth wrong try locks the vault out.
    prisma.user.findUniqueOrThrow.mockResolvedValueOnce(person()).mockResolvedValueOnce({ vaultUnlockFailures: 10, vaultUnlockFailedAt: new Date() });
    await expect(service.verifyUnlock(user, { challengeId: 'c1', code: '000000' })).rejects.toMatchObject({ response: { reason: 'VAULT_LOCKED_OUT' } });
  });

  it('refuses even the right code while the vault is locked out', async () => {
    const { service, codes, jwt, prisma } = setup();
    prisma.user.findUniqueOrThrow.mockResolvedValue(person({ vaultUnlockFailures: 10, vaultUnlockFailedAt: new Date() }));
    await expect(service.verifyUnlock(user, { challengeId: 'c1', code: '284913' })).rejects.toMatchObject({ response: { reason: 'VAULT_LOCKED_OUT' } });
    expect(codes.verify).not.toHaveBeenCalled();
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it('refuses a code sent to another sign-in, or before the vault password changed', async () => {
    const { service, codes, jwt } = setup();
    codes.verify.mockResolvedValueOnce({ id: 'c1', payload: { sessionId: 's2', ver: VER } });
    await expect(service.verifyUnlock(user, { challengeId: 'c1', code: '284913' })).rejects.toMatchObject({ response: { reason: 'CHALLENGE_NOT_FOUND' } });

    codes.verify.mockResolvedValueOnce({ id: 'c1', payload: { sessionId: 's1', ver: 'an-older-password' } });
    await expect(service.verifyUnlock(user, { challengeId: 'c1', code: '284913' })).rejects.toMatchObject({ response: { reason: 'CHALLENGE_NOT_FOUND' } });
    expect(codes.consume).not.toHaveBeenCalled();
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it('refuses a code already used', async () => {
    const { service, codes, jwt } = setup();
    codes.verify.mockResolvedValue({ id: 'c1', payload: { sessionId: 's1', ver: VER } });
    codes.consume.mockResolvedValue(false);
    await expect(service.verifyUnlock(user, { challengeId: 'c1', code: '284913' })).rejects.toMatchObject({ response: { reason: 'CODE_USED' } });
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it("sends a code again only for its own sign-in and vault password", async () => {
    const { service, codes } = setup();
    codes.peek.mockResolvedValueOnce({ id: 'c1', payload: { sessionId: 's2', ver: VER } });
    await expect(service.resendUnlockCode(user, 'c1')).rejects.toMatchObject({ response: { reason: 'CHALLENGE_NOT_FOUND' } });
    codes.peek.mockResolvedValueOnce({ id: 'c1', payload: { sessionId: 's1', ver: 'an-older-password' } });
    await expect(service.resendUnlockCode(user, 'c1')).rejects.toMatchObject({ response: { reason: 'CHALLENGE_NOT_FOUND' } });
    expect(codes.resend).not.toHaveBeenCalled();

    codes.peek.mockResolvedValueOnce({ id: 'c1', payload: { sessionId: 's1', ver: VER } });
    await expect(service.resendUnlockCode(user, 'c1')).resolves.toMatchObject({ challengeId: 'c1' });
  });

  it('opens a brand-new vault on its first password, but not after a change', async () => {
    const { service, jwt, prisma } = setup();

    prisma.user.findUniqueOrThrow.mockResolvedValueOnce(person({ vaultPasswordHash: null }));
    await expect(service.setVaultPassword('u1', { currentPassword: 'login pass 1', vaultPassword: 'green kite river 77' })).resolves.toMatchObject({ success: true, vaultToken: 'vault-token' });
    expect(prisma.user.updateMany).toHaveBeenCalledWith({ where: { id: 'u1', vaultPasswordHash: null }, data: { vaultPasswordHash: expect.any(String) } });

    jwt.sign.mockClear();
    prisma.user.findUniqueOrThrow.mockResolvedValueOnce(person());
    await expect(service.setVaultPassword('u1', { currentPassword: 'login pass 1', currentVaultPassword: 'mango tree 42', vaultPassword: 'green kite river 77' })).resolves.toEqual({ success: true });
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it('refuses a second setup that lands at the same time', async () => {
    const { service, jwt, prisma } = setup();
    prisma.user.findUniqueOrThrow.mockResolvedValueOnce(person({ vaultPasswordHash: null }));
    prisma.user.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.setVaultPassword('u1', { currentPassword: 'login pass 1', vaultPassword: 'green kite river 77' })).rejects.toMatchObject({ response: { reason: 'VAULT_PASSWORD_CHANGED' } });
    expect(jwt.sign).not.toHaveBeenCalled();
  });
});
