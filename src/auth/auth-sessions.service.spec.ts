import { APIError } from 'better-auth/api';
import { AuthSessionsService } from './auth-sessions.service.js';

const setup = () => {
  const internalAdapter = { createSession: vi.fn(), deleteSession: vi.fn(), deleteUserSessions: vi.fn() };
  const auth = { api: { signInEmail: vi.fn() }, $context: Promise.resolve({ internalAdapter }) };
  const prisma = {
    authSession: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), updateMany: vi.fn() },
  };
  const service = new AuthSessionsService(auth as never, prisma as never);
  return { service, auth, prisma, internalAdapter };
};

describe('AuthSessionsService', () => {
  it('signs in through better-auth with the client address and device', async () => {
    const { service, auth, prisma } = setup();
    auth.api.signInEmail.mockResolvedValue({ token: 'tok', user: { id: 'user-1' } });
    prisma.authSession.findUniqueOrThrow.mockResolvedValue({ id: 'session-1' });

    await expect(service.signInWithPassword('a@example.com', 'pw', { ipAddress: '203.0.113.7', userAgent: 'UA' })).resolves.toEqual({
      userId: 'user-1',
      sessionId: 'session-1',
    });
    const { body, headers } = auth.api.signInEmail.mock.calls[0][0];
    expect(body).toEqual({ email: 'a@example.com', password: 'pw' });
    expect(headers.get('x-forwarded-for')).toBe('203.0.113.7');
    expect(headers.get('user-agent')).toBe('UA');
  });

  it.each([
    ['a wrong password', 'UNAUTHORIZED'],
    ['an account the session hook refuses', 'FORBIDDEN'],
  ] as const)('answers null for %s', async (_, status) => {
    const { service, auth } = setup();
    auth.api.signInEmail.mockRejectedValue(new APIError(status));
    await expect(service.signInWithPassword('a@example.com', 'pw', {})).resolves.toBeNull();
  });

  it('lets unexpected failures through', async () => {
    const { service, auth } = setup();
    auth.api.signInEmail.mockRejectedValue(new Error('database down'));
    await expect(service.signInWithPassword('a@example.com', 'pw', {})).rejects.toThrow('database down');
  });

  it('only returns sessions that have not expired', async () => {
    const { service, prisma } = setup();
    prisma.authSession.findUnique.mockResolvedValueOnce({ id: 's', expiresAt: new Date(Date.now() - 1000) });
    await expect(service.findActive('s')).resolves.toBeNull();
    const live = { id: 's', expiresAt: new Date(Date.now() + 60_000) };
    prisma.authSession.findUnique.mockResolvedValueOnce(live);
    await expect(service.findActive('s')).resolves.toBe(live);
  });

  it('revokes through better-auth by token, and ignores unknown sessions', async () => {
    const { service, prisma, internalAdapter } = setup();
    prisma.authSession.findUnique.mockResolvedValueOnce(null);
    await service.revoke('gone');
    expect(internalAdapter.deleteSession).not.toHaveBeenCalled();

    prisma.authSession.findUnique.mockResolvedValueOnce({ token: 'tok' });
    await service.revoke('session-1');
    expect(internalAdapter.deleteSession).toHaveBeenCalledWith('tok');
  });

  it('creates a session carrying the device details', async () => {
    const { service, internalAdapter } = setup();
    internalAdapter.createSession.mockResolvedValue({ id: 'session-2' });
    await expect(service.create('user-1', { ipAddress: '198.51.100.1', userAgent: 'UA' })).resolves.toBe('session-2');
    expect(internalAdapter.createSession).toHaveBeenCalledWith('user-1', false, { ipAddress: '198.51.100.1', userAgent: 'UA' });
  });
});
