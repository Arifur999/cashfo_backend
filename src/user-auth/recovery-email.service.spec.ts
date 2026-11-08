import { RecoveryEmailService } from './recovery-email.service.js';

describe('RecoveryEmailService', () => {
  const user = { id: 'u1', name: 'Nusrat', email: 'nusrat@example.com', preferredLanguage: 'EN' };
  const setup = (hasPassword = true, passwordOk = true) => {
    const prisma = { user: { findUniqueOrThrow: vi.fn().mockResolvedValue(user), update: vi.fn().mockResolvedValue({ recoveryEmail: null }) } };
    const credentials = { has: vi.fn().mockResolvedValue(hasPassword), verify: vi.fn().mockResolvedValue(passwordOk) };
    const codes = { issue: vi.fn().mockResolvedValue({ challengeId: 'c1' }) };
    return { service: new RecoveryEmailService(prisma as never, credentials as never, codes as never), codes, prisma };
  };

  it('sends the code to the new address, never by SMS, once the password is right', async () => {
    const { service, codes } = setup();
    await service.start('u1', { email: 'backup@example.com', password: 'secret' });
    expect(codes.issue).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'backup@example.com', phone: null }),
      'RECOVERY_EMAIL',
      { email: 'backup@example.com' },
      expect.anything(),
    );
  });

  it('refuses the sign-in email and a wrong password', async () => {
    await expect(setup().service.start('u1', { email: 'nusrat@example.com', password: 'secret' })).rejects.toThrow('Use a different email');
    await expect(setup(true, false).service.start('u1', { email: 'backup@example.com', password: 'nope' })).rejects.toThrow();
    await expect(setup(true, true).service.start('u1', { email: 'backup@example.com' })).rejects.toThrow();
  });

  it('needs no password for a Google-only account', async () => {
    const { service, codes } = setup(false);
    await service.start('u1', { email: 'backup@example.com' });
    expect(codes.issue).toHaveBeenCalled();
  });
});
