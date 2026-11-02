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
// What recordFailedUnlock reads back after counting a try.
const failures = (count: number) => ({ vaultUnlockFailures: count, vaultUnlockFailedAt: new Date() });

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
    issueOrReuse: vi.fn().mockResolvedValue(CHALLENGE),
    resend: vi.fn().mockResolvedValue(CHALLENGE),
    check: vi.fn(),
    consume: vi.fn().mockResolvedValue(true),
  };
  const credentials = { verify: vi.fn().mockImplementation((_id: string, password: string) => Promise.resolve(password === 'login pass 1')), has: vi.fn().mockResolvedValue(true) };
  const service = new PasswordVaultService(prisma as never, jwt as never, configService as never, credentials as never, {} as never, codes as never);
  return { service, codes, jwt, prisma };
};

// One try counted: the person's row, then the count read back.
const countedAs = (prisma: ReturnType<typeof setup>['prisma'], count: number, over: Record<string, unknown> = {}) =>
  prisma.user.findUniqueOrThrow.mockResolvedValueOnce(person(over)).mockResolvedValueOnce(failures(count));

describe('PasswordVaultService two-step unlock', () => {
  it("answers the right vault password with this sign-in's code (a waiting one reused), by email first, not a vault token", async () => {
    const { service, codes, jwt, prisma } = setup();

    const answer = await service.unlock(user, { vaultPassword: 'mango tree 42' });

    expect(answer).toMatchObject({ codeRequired: true, challengeId: 'c1' });
    expect(answer).not.toHaveProperty('vaultToken');
    expect(jwt.sign).not.toHaveBeenCalled();
    const [recipient, purpose, payload, action, options] = codes.issueOrReuse.mock.calls[0];
    expect(recipient).toMatchObject({ id: 'u1', email: 'khaled@example.com' });
    expect([purpose, payload, action.en]).toEqual(['VAULT_UNLOCK', { sessionId: 's1', ver: VER }, 'open your Password Manager']);
    expect(options).toMatchObject({ emailFirst: true, replace: { payload: { path: ['sessionId'], equals: 's1' } } });
    // Only this sign-in's code, for this vault password, is reused.
    expect(options.belongs({ payload: { sessionId: 's1', ver: VER } })).toBe(true);
    expect(options.belongs({ payload: { sessionId: 's2', ver: VER } })).toBe(false);
    expect(options.belongs({ payload: { sessionId: 's1', ver: 'old' } })).toBe(false);
    // The right password alone doesn't clear the wrong tries: only the code does.
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('opens with the password alone when VAULT_UNLOCK_CODE is off', async () => {
    const { service, codes } = setup({ VAULT_UNLOCK_CODE: 'off' });
    await expect(service.unlock(user, { vaultPassword: 'mango tree 42' })).resolves.toMatchObject({ vaultToken: 'vault-token' });
    expect(codes.issueOrReuse).not.toHaveBeenCalled();
  });

  it('opens the vault with the code from the same sign-in and clears the tries', async () => {
    const { service, codes, jwt, prisma } = setup();
    countedAs(prisma, 1);
    codes.check.mockResolvedValue({ ok: true, row: { id: 'c1', payload: { sessionId: 's1', ver: VER } } });

    await expect(service.verifyUnlock(user, { challengeId: 'c1', code: '284913' })).resolves.toMatchObject({ vaultToken: 'vault-token', expiresInSec: 600 });
    expect(codes.check).toHaveBeenCalledWith('u1', 'c1', 'VAULT_UNLOCK', '284913');
    expect(codes.consume).toHaveBeenCalled();
    expect(jwt.sign).toHaveBeenCalledWith({ sub: 'u1', scope: 'vault', ver: VER }, expect.anything());
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { vaultUnlockFailures: 0, vaultUnlockFailedAt: null } });
  });

  it("counts every code try against the person's ten before looking at it", async () => {
    const { service, codes, prisma } = setup();
    codes.check.mockResolvedValue({ ok: false, attemptsLeft: 4 });

    // Two tries left for the person: the code's four are cut to two.
    countedAs(prisma, 8);
    await expect(service.verifyUnlock(user, { challengeId: 'c1', code: '000000' })).rejects.toMatchObject({ response: { reason: 'CODE_WRONG', attemptsLeft: 2, triesLeft: 2 } });
    expect(prisma.user.updateMany).toHaveBeenCalled();

    // The tenth wrong try locks the vault out.
    countedAs(prisma, 10);
    await expect(service.verifyUnlock(user, { challengeId: 'c1', code: '000000' })).rejects.toMatchObject({ response: { reason: 'VAULT_LOCKED_OUT' } });
  });

  it('refuses a try past the tenth without looking at the code (tries sent all at once)', async () => {
    const { service, codes, jwt, prisma } = setup();
    countedAs(prisma, 11);
    await expect(service.verifyUnlock(user, { challengeId: 'c1', code: '284913' })).rejects.toMatchObject({ response: { reason: 'VAULT_LOCKED_OUT', message: expect.stringMatching(/^Too many wrong tries/) } });
    expect(codes.check).not.toHaveBeenCalled();
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it('refuses even the right code while the vault is locked out', async () => {
    const { service, codes, jwt, prisma } = setup();
    prisma.user.findUniqueOrThrow.mockResolvedValue(person(failures(10)));
    await expect(service.verifyUnlock(user, { challengeId: 'c1', code: '284913' })).rejects.toMatchObject({ response: { reason: 'VAULT_LOCKED_OUT' } });
    expect(codes.check).not.toHaveBeenCalled();
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it('refuses a code sent to another sign-in, or before the vault password changed', async () => {
    const { service, codes, jwt, prisma } = setup();
    for (const payload of [{ sessionId: 's2', ver: VER }, { sessionId: 's1', ver: 'an-older-password' }]) {
      countedAs(prisma, 1);
      codes.check.mockResolvedValueOnce({ ok: true, row: { id: 'c1', payload } });
      await expect(service.verifyUnlock(user, { challengeId: 'c1', code: '284913' })).rejects.toMatchObject({ response: { reason: 'CHALLENGE_NOT_FOUND' } });
    }
    expect(codes.consume).not.toHaveBeenCalled();
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it('refuses a code already used', async () => {
    const { service, codes, jwt, prisma } = setup();
    countedAs(prisma, 1);
    codes.check.mockResolvedValue({ ok: true, row: { id: 'c1', payload: { sessionId: 's1', ver: VER } } });
    codes.consume.mockResolvedValue(false);
    await expect(service.verifyUnlock(user, { challengeId: 'c1', code: '284913' })).rejects.toMatchObject({ response: { reason: 'CODE_USED' } });
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it('sends a code again only for its own sign-in and vault password', async () => {
    const { service, codes } = setup();
    await expect(service.resendUnlockCode(user, 'c1')).resolves.toMatchObject({ challengeId: 'c1' });
    const [, id, purpose, , options] = codes.resend.mock.calls[0];
    expect([id, purpose, options.emailFirst]).toEqual(['c1', 'VAULT_UNLOCK', true]);
    expect(options.belongs({ payload: { sessionId: 's2', ver: VER } })).toBe(false);
    expect(options.belongs({ payload: { sessionId: 's1', ver: VER } })).toBe(true);
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
