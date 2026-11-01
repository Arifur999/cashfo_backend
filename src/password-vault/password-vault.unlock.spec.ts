import * as bcrypt from 'bcrypt';
import { PasswordVaultService } from './password-vault.service.js';
import { vaultPasswordFingerprint } from './vault-crypto.js';

const HASH = bcrypt.hashSync('mango tree 42', 4);
const user = { id: 'u1', sessionId: 's1' } as never;

const setup = () => {
  const prisma = {
    user: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        name: 'Khaled Mahmud',
        email: 'khaled@example.com',
        phone: '01711482915',
        preferredLanguage: 'EN',
        vaultPasswordHash: HASH,
        vaultLockMinutes: null,
        vaultUnlockFailures: 0,
        vaultUnlockFailedAt: null,
      }),
      update: vi.fn(),
    },
  };
  const jwt = { sign: vi.fn().mockReturnValue('vault-token') };
  const config = { get: vi.fn((key: string) => (key === 'VAULT_TOKEN_EXPIRES_IN' ? '10m' : 'secret')) };
  const codes = {
    issue: vi.fn().mockResolvedValue({ challengeId: 'c1', channel: 'EMAIL', sentTo: 'k***@example.com', resendAfterSec: 30, attemptsLeft: 5, sendsLeft: 4 }),
    verify: vi.fn(),
    consume: vi.fn().mockResolvedValue(true),
  };
  const service = new PasswordVaultService(prisma as never, jwt as never, config as never, {} as never, {} as never, codes as never);
  return { service, codes, jwt };
};

describe('PasswordVaultService two-step unlock', () => {
  it('answers the right vault password with an emailed code, not a vault token', async () => {
    const { service, codes, jwt } = setup();

    const answer = await service.unlock(user, { vaultPassword: 'mango tree 42' });

    expect(answer).toMatchObject({ codeRequired: true, challengeId: 'c1', sentTo: 'k***@example.com' });
    expect(answer).not.toHaveProperty('vaultToken');
    expect(jwt.sign).not.toHaveBeenCalled();
    expect(codes.issue).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u1', email: 'khaled@example.com' }),
      'VAULT_UNLOCK',
      { sessionId: 's1', ver: vaultPasswordFingerprint(HASH) },
      expect.objectContaining({ en: 'open your Password Manager' }),
      { emailOnly: true },
    );
  });

  it('opens the vault with the code from the same sign-in', async () => {
    const { service, codes, jwt } = setup();
    codes.verify.mockResolvedValue({ id: 'c1', payload: { sessionId: 's1', ver: vaultPasswordFingerprint(HASH) } });

    await expect(service.verifyUnlock(user, { challengeId: 'c1', code: '284913' })).resolves.toMatchObject({ vaultToken: 'vault-token', expiresInSec: 600 });
    expect(codes.verify).toHaveBeenCalledWith('u1', 'c1', 'VAULT_UNLOCK', '284913');
    expect(codes.consume).toHaveBeenCalled();
    expect(jwt.sign).toHaveBeenCalledWith({ sub: 'u1', scope: 'vault', ver: vaultPasswordFingerprint(HASH) }, expect.anything());
  });

  it('refuses a code sent to another sign-in, or before the vault password changed', async () => {
    const { service, codes, jwt } = setup();
    codes.verify.mockResolvedValueOnce({ id: 'c1', payload: { sessionId: 's2', ver: vaultPasswordFingerprint(HASH) } });
    await expect(service.verifyUnlock(user, { challengeId: 'c1', code: '284913' })).rejects.toMatchObject({ response: { reason: 'CHALLENGE_NOT_FOUND' } });

    codes.verify.mockResolvedValueOnce({ id: 'c1', payload: { sessionId: 's1', ver: 'an-older-password' } });
    await expect(service.verifyUnlock(user, { challengeId: 'c1', code: '284913' })).rejects.toMatchObject({ response: { reason: 'CHALLENGE_NOT_FOUND' } });
    expect(codes.consume).not.toHaveBeenCalled();
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it('refuses a code already used', async () => {
    const { service, codes, jwt } = setup();
    codes.verify.mockResolvedValue({ id: 'c1', payload: { sessionId: 's1', ver: vaultPasswordFingerprint(HASH) } });
    codes.consume.mockResolvedValue(false);
    await expect(service.verifyUnlock(user, { challengeId: 'c1', code: '284913' })).rejects.toMatchObject({ response: { reason: 'CODE_USED' } });
    expect(jwt.sign).not.toHaveBeenCalled();
  });
});
