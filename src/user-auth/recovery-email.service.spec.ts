import { RecoveryEmailService } from './recovery-email.service.js';

describe('RecoveryEmailService', () => {
  const user = { id: 'u1', name: 'Nusrat', email: 'nusrat@example.com', preferredLanguage: 'EN' };
  const requester = { id: 'u1', sessionId: 's1' } as never;
  const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);
  const setup = (hasPassword = true, passwordOk = true, session: object | null = { userId: 'u1', createdAt: minutesAgo(2) }) => {
    const prisma = { user: { findUniqueOrThrow: vi.fn().mockResolvedValue(user), update: vi.fn().mockResolvedValue({ recoveryEmail: null }) } };
    const credentials = { has: vi.fn().mockResolvedValue(hasPassword), verify: vi.fn().mockResolvedValue(passwordOk) };
    const codes = { issue: vi.fn().mockResolvedValue({ challengeId: 'c1' }) };
    const sessions = { findActive: vi.fn().mockResolvedValue(session) };
    return { service: new RecoveryEmailService(prisma as never, credentials as never, codes as never, sessions as never), codes, prisma };
  };

  it('sends the code to the new address, never by SMS, once the password is right', async () => {
    const { service, codes } = setup();
    await service.start(requester, { email: 'backup@example.com', password: 'secret' });
    expect(codes.issue).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'backup@example.com', phone: null }),
      'RECOVERY_EMAIL',
      { email: 'backup@example.com' },
      expect.anything(),
    );
  });

  it('refuses the sign-in email and a wrong password', async () => {
    await expect(setup().service.start(requester, { email: 'nusrat@example.com', password: 'secret' })).rejects.toThrow('Use a different email');
    await expect(setup(true, false).service.start(requester, { email: 'backup@example.com', password: 'nope' })).rejects.toThrow();
    await expect(setup(true, true).service.start(requester, { email: 'backup@example.com' })).rejects.toThrow();
  });

  it('lets a Google-only account add one within minutes of signing in, without a password', async () => {
    const { service, codes } = setup(false);
    await service.start(requester, { email: 'backup@example.com' });
    expect(codes.issue).toHaveBeenCalled();
  });

  it('asks a Google-only account on an older sign-in to sign in again, so a borrowed device cannot add its own address', async () => {
    const { service, codes } = setup(false, true, { userId: 'u1', createdAt: minutesAgo(30) });
    await expect(service.start(requester, { email: 'backup@example.com' })).rejects.toThrow('sign in again');
    expect(codes.issue).not.toHaveBeenCalled();
    await expect(setup(false, true, null).service.start(requester, { email: 'backup@example.com' })).rejects.toThrow('sign in again');
  });
});
