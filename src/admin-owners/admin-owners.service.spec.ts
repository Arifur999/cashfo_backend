import { NotFoundException } from '@nestjs/common';
import { AdminOwnersService } from './admin-owners.service.js';

const setup = (owner: { id: string } | null) => {
  const prisma = {
    user: { findUnique: vi.fn().mockResolvedValue(owner) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const credentials = { set: vi.fn().mockResolvedValue(undefined) };
  const sessions = { revokeAllForUser: vi.fn().mockResolvedValue(undefined) };
  const service = new AdminOwnersService(prisma as never, {} as never, sessions as never, credentials as never);
  return { service, prisma, credentials, sessions };
};

describe('AdminOwnersService.resetPassword', () => {
  it('sets a one-time password, signs the owner out everywhere and logs it without the password', async () => {
    const { service, prisma, credentials, sessions } = setup({ id: 'u1' });

    const { temporaryPassword } = await service.resetPassword('u1', 'admin-1', '203.0.113.9');

    expect(temporaryPassword).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(credentials.set).toHaveBeenCalledWith('u1', temporaryPassword);
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith('u1');
    const audit = prisma.auditLog.create.mock.calls[0][0].data;
    expect(audit).toMatchObject({ adminUserId: 'admin-1', action: 'OWNER_PASSWORD_RESET', entityId: 'u1', ipAddress: '203.0.113.9' });
    expect(JSON.stringify(audit)).not.toContain(temporaryPassword);
  });

  it('refuses someone who is not a customer', async () => {
    const { service, credentials } = setup(null);
    await expect(service.resetPassword('admin-2', 'admin-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(credentials.set).not.toHaveBeenCalled();
  });
});
