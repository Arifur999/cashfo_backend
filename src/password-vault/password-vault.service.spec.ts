import { PasswordVaultService } from './password-vault.service.js';

const setup = (vaultPasswordHash: string | null, entryCount: number, extra: Record<string, unknown> = {}) => {
  const prisma = {
    user: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ vaultPasswordHash, vaultLockMinutes: null, vaultUnlockFailures: 0, vaultUnlockFailedAt: null, ...extra }),
    },
    vaultEntry: { count: vi.fn().mockResolvedValue(entryCount) },
  };
  const credentials = { has: vi.fn().mockResolvedValue(true) };
  const config = { get: vi.fn().mockReturnValue('10m') };
  const service = new PasswordVaultService(prisma as never, {} as never, config as never, credentials as never, {} as never, {} as never);
  return { service, prisma };
};

describe('PasswordVaultService.getStatus', () => {
  it('says whether the vault is set up and counts its logins without opening them', async () => {
    const { service, prisma } = setup('$2b$10$hash', 14);

    await expect(service.getStatus('u1')).resolves.toEqual({
      hasVaultPassword: true,
      entryCount: 14,
      hasAccountPassword: true,
      lockMinutes: null,
      effectiveMinutes: 10,
      triesLeft: 10,
      retryAfterSec: 0,
    });
    expect(prisma.user.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: 'u1' },
      select: { vaultPasswordHash: true, vaultLockMinutes: true, vaultUnlockFailures: true, vaultUnlockFailedAt: true },
    });
    expect(prisma.vaultEntry.count).toHaveBeenCalledWith({ where: { userId: 'u1' } });
  });

  it('reports a vault that was never set up', async () => {
    const { service } = setup(null, 0);
    await expect(service.getStatus('u1')).resolves.toMatchObject({ hasVaultPassword: false, entryCount: 0, hasAccountPassword: true });
  });

  it("caps the person's lock time by the server's", async () => {
    const { service } = setup('$2b$10$hash', 1, { vaultLockMinutes: 25 });
    await expect(service.getStatus('u1')).resolves.toMatchObject({ lockMinutes: 25, effectiveMinutes: 10 });
  });
});
