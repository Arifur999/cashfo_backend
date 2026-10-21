import { PasswordVaultService } from './password-vault.service.js';

const setup = (vaultPasswordHash: string | null, entryCount: number) => {
  const prisma = {
    user: { findUniqueOrThrow: vi.fn().mockResolvedValue({ vaultPasswordHash }) },
    vaultEntry: { count: vi.fn().mockResolvedValue(entryCount) },
  };
  const credentials = { has: vi.fn().mockResolvedValue(true) };
  const service = new PasswordVaultService(prisma as never, {} as never, {} as never, credentials as never);
  return { service, prisma };
};

describe('PasswordVaultService.getStatus', () => {
  it('says whether the vault is set up and counts its logins without opening them', async () => {
    const { service, prisma } = setup('$2b$10$hash', 14);

    await expect(service.getStatus('u1')).resolves.toEqual({ hasVaultPassword: true, entryCount: 14, hasAccountPassword: true });
    expect(prisma.user.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: 'u1' }, select: { vaultPasswordHash: true } });
    expect(prisma.vaultEntry.count).toHaveBeenCalledWith({ where: { userId: 'u1' } });
  });

  it('reports a vault that was never set up', async () => {
    const { service } = setup(null, 0);
    await expect(service.getStatus('u1')).resolves.toEqual({ hasVaultPassword: false, entryCount: 0, hasAccountPassword: true });
  });
});
