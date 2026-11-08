import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { SignInService } from './sign-in.service.js';

const ADMIN_SIGNED_IN = { accessToken: 'a', refreshToken: 'r', adminUser: { id: 'admin-1', name: 'A', email: 'a@x.co', role: 'SUPER_ADMIN' } };
const USER_SIGNED_IN = {
  accessToken: 'u',
  refreshToken: 'r',
  user: { id: 'user-1', name: 'U', email: 'u@x.co', preferredLanguage: 'EN' },
  defaultBusinessId: 'biz-1',
};

const setup = (role: string | null) => {
  const prisma = {
    user: {
      findUnique: vi
        .fn()
        .mockImplementation(({ select }: { select?: unknown }) =>
          Promise.resolve(role === null ? null : select ? { role } : { id: 'acct-1', email: 'x@x.co', role, status: 'ACTIVE' }),
        ),
    },
  };
  const sessions = { fromCookie: vi.fn(), create: vi.fn().mockResolvedValue('session-2') };
  const adminAuth = {
    login: vi.fn().mockResolvedValue(ADMIN_SIGNED_IN),
    exchangeSession: vi.fn().mockResolvedValue(ADMIN_SIGNED_IN),
    finishSignIn: vi.fn().mockResolvedValue(ADMIN_SIGNED_IN),
  };
  const userAuth = {
    login: vi.fn().mockResolvedValue(USER_SIGNED_IN),
    exchangeSession: vi.fn().mockResolvedValue(USER_SIGNED_IN),
    finishSignIn: vi.fn().mockResolvedValue(USER_SIGNED_IN),
  };
  const twoStep = {
    answerChallenge: vi.fn().mockResolvedValue({ userId: 'acct-1', backupCodesLeft: null }),
    trustDevice: vi.fn().mockResolvedValue({ token: 'trusted-token', expiresAt: new Date('2026-11-26') }),
  };
  const service = new SignInService(prisma as never, sessions as never, adminAuth as never, userAuth as never, twoStep as never);
  return { service, prisma, sessions, adminAuth, userAuth, twoStep };
};

const dto = { email: 'someone@x.co', password: 'pw' };
const client = { ipAddress: '203.0.113.1', userAgent: 'UA' };

describe('SignInService', () => {
  it('signs an admin in on the admin side', async () => {
    const { service, adminAuth, userAuth } = setup('SUPPORT_ADMIN');
    await expect(service.withPassword(dto, client)).resolves.toMatchObject({ audience: 'admin', account: { role: 'SUPER_ADMIN' } });
    expect(adminAuth.login).toHaveBeenCalledWith(dto, client, undefined);
    expect(userAuth.login).not.toHaveBeenCalled();
  });

  it('signs an end user in on the user side, with their workspace', async () => {
    const { service, adminAuth } = setup('USER');
    await expect(service.withPassword(dto, client)).resolves.toEqual({
      audience: 'user',
      accessToken: 'u',
      refreshToken: 'r',
      account: { id: 'user-1', name: 'U', email: 'u@x.co', role: 'USER', startPage: 'DASHBOARD' },
      defaultBusinessId: 'biz-1',
    });
    expect(adminAuth.login).not.toHaveBeenCalled();
  });

  it('leaves unknown emails to the user side, which records the attempt', async () => {
    const { service, userAuth } = setup(null);
    await service.withPassword(dto, client);
    expect(userAuth.login).toHaveBeenCalledWith(dto, client, undefined);
  });

  it('passes the trusted-device header to the side that signs the account in', async () => {
    const { service, userAuth } = setup('USER');
    await service.withPassword(dto, client, 'tok-a,tok-b');
    expect(userAuth.login).toHaveBeenCalledWith(dto, client, 'tok-a,tok-b');
  });

  it('answers a pending second step as it is, with no tokens', async () => {
    const pending = { twoStepRequired: true, challengeToken: 'c', audience: 'user', expiresAt: new Date(), email: 'u@x.co' };
    const { service, userAuth } = setup('USER');
    userAuth.login.mockResolvedValue(pending);
    await expect(service.withPassword(dto, client)).resolves.toBe(pending);

    const setupPending = { twoStepSetupRequired: true, setupToken: 's', audience: 'admin', expiresAt: new Date(), email: 'a@x.co' };
    const admin = setup('SUPER_ADMIN');
    admin.adminAuth.exchangeSession.mockResolvedValue(setupPending);
    admin.sessions.fromCookie.mockResolvedValue({ userId: 'admin-1', sessionId: 's' });
    await expect(admin.service.withSession('cookie', client)).resolves.toBe(setupPending);
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

describe('SignInService second step', () => {
  it('opens a new session only after the code checks out, on the right side', async () => {
    const { service, sessions, twoStep, adminAuth } = setup('FINANCE_ADMIN');
    await expect(service.withTwoStep({ challengeToken: 'c', code: '123456' }, client)).resolves.toMatchObject({ audience: 'admin', accessToken: 'a' });
    expect(twoStep.answerChallenge).toHaveBeenCalledWith('c', { code: '123456', backupCode: undefined }, client);
    expect(sessions.create).toHaveBeenCalledWith('acct-1', client);
    expect(adminAuth.finishSignIn).toHaveBeenCalledWith(expect.objectContaining({ id: 'acct-1' }), 'session-2', client);
    expect(twoStep.trustDevice).not.toHaveBeenCalled();
  });

  it('hands out the 30-day token when the computer is trusted, and the backup codes left', async () => {
    const { service, twoStep } = setup('USER');
    twoStep.answerChallenge.mockResolvedValue({ userId: 'acct-1', backupCodesLeft: 9 });
    const result = await service.withTwoStep({ challengeToken: 'c', backupCode: 'abcd-efgh', trustDevice: true }, client);
    expect(result).toMatchObject({ audience: 'user', trustedDeviceToken: 'trusted-token', backupCodesLeft: 9 });
    expect(twoStep.trustDevice).toHaveBeenCalledWith('acct-1', client);
  });

  it('wants exactly one of a code and a backup code', async () => {
    const { service, twoStep } = setup('USER');
    await expect(service.withTwoStep({ challengeToken: 'c' }, client)).rejects.toThrow(BadRequestException);
    await expect(service.withTwoStep({ challengeToken: 'c', code: '123456', backupCode: 'abcd-efgh' }, client)).rejects.toThrow(BadRequestException);
    expect(twoStep.answerChallenge).not.toHaveBeenCalled();
  });

  it('opens no session when the code is wrong', async () => {
    const { service, sessions, twoStep } = setup('USER');
    twoStep.answerChallenge.mockRejectedValue(new BadRequestException('wrong'));
    await expect(service.withTwoStep({ challengeToken: 'c', code: '000000' }, client)).rejects.toThrow(BadRequestException);
    expect(sessions.create).not.toHaveBeenCalled();
  });
});
