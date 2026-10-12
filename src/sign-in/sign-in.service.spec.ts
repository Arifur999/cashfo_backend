import { UnauthorizedException } from '@nestjs/common';
import { SignInService } from './sign-in.service.js';

const setup = (role: string | null) => {
  const prisma = { user: { findUnique: vi.fn().mockResolvedValue(role ? { role } : null) } };
  const sessions = { fromCookie: vi.fn() };
  const adminAuth = {
    login: vi.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r', adminUser: { id: 'admin-1', name: 'A', email: 'a@x.co', role: 'SUPER_ADMIN' } }),
    exchangeSession: vi.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r', adminUser: { id: 'admin-1', name: 'A', email: 'a@x.co', role: 'SUPER_ADMIN' } }),
  };
  const userAuth = {
    login: vi.fn().mockResolvedValue({ accessToken: 'u', refreshToken: 'r', user: { id: 'user-1', name: 'U', email: 'u@x.co', preferredLanguage: 'EN' }, defaultBusinessId: 'biz-1' }),
    exchangeSession: vi.fn().mockResolvedValue({ accessToken: 'u', refreshToken: 'r', user: { id: 'user-1', name: 'U', email: 'u@x.co', preferredLanguage: 'EN' }, defaultBusinessId: 'biz-1' }),
  };
  const service = new SignInService(prisma as never, sessions as never, adminAuth as never, userAuth as never);
  return { service, prisma, sessions, adminAuth, userAuth };
};

const dto = { email: 'someone@x.co', password: 'pw' };
const client = { ipAddress: '203.0.113.1', userAgent: 'UA' };

describe('SignInService', () => {
  it('signs an admin in on the admin side', async () => {
    const { service, adminAuth, userAuth } = setup('SUPPORT_ADMIN');
    await expect(service.withPassword(dto, client)).resolves.toMatchObject({ audience: 'admin', account: { role: 'SUPER_ADMIN' } });
    expect(adminAuth.login).toHaveBeenCalledWith(dto, client);
    expect(userAuth.login).not.toHaveBeenCalled();
  });

  it('signs an end user in on the user side, with their workspace', async () => {
    const { service, adminAuth } = setup('USER');
    await expect(service.withPassword(dto, client)).resolves.toEqual({
      audience: 'user',
      accessToken: 'u',
      refreshToken: 'r',
      account: { id: 'user-1', name: 'U', email: 'u@x.co', role: 'USER' },
      defaultBusinessId: 'biz-1',
    });
    expect(adminAuth.login).not.toHaveBeenCalled();
  });

  it('leaves unknown emails to the user side, which records the attempt', async () => {
    const { service, userAuth } = setup(null);
    await service.withPassword(dto, client);
    expect(userAuth.login).toHaveBeenCalledWith(dto, client);
  });

  it('exchanges a session on the side its account belongs to', async () => {
    const admin = setup('CONTENT_ADMIN');
    admin.sessions.fromCookie.mockResolvedValue({ userId: 'admin-1', sessionId: 's' });
    await expect(admin.service.withSession('cookie', client)).resolves.toMatchObject({ audience: 'admin' });
    expect(admin.prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'admin-1' }, select: { role: true } });

    const user = setup('USER');
    user.sessions.fromCookie.mockResolvedValue({ userId: 'user-1', sessionId: 's' });
    await expect(user.service.withSession('cookie', client)).resolves.toMatchObject({ audience: 'user', defaultBusinessId: 'biz-1' });
  });

  it('refuses when there is no live session to exchange', async () => {
    const { service, sessions } = setup('USER');
    sessions.fromCookie.mockResolvedValue(null);
    await expect(service.withSession(undefined, client)).rejects.toThrow(UnauthorizedException);
  });
});
