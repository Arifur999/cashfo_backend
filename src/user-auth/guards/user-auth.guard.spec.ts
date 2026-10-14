import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { UserAuthGuard } from './user-auth.guard.js';

const setup = ({ impersonatedBy = null as string | null, method = 'GET', status = 'ACTIVE', role = 'USER' } = {}) => {
  const authenticator = {
    authenticate: vi.fn().mockResolvedValue({ user: { id: 'user-1', email: 'user@example.com', role, status }, sessionId: 'session-1', impersonatedBy }),
  };
  const request: Record<string, unknown> = { method };
  const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
  return { guard: new UserAuthGuard(authenticator as never), request, context };
};

describe('UserAuthGuard', () => {
  it('attaches the customer and their session', async () => {
    const { guard, request, context } = setup({ method: 'POST' });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({ id: 'user-1', email: 'user@example.com', sessionId: 'session-1' });
  });

  it('lets an admin view of the account read, and says whose view it is', async () => {
    const { guard, request, context } = setup({ impersonatedBy: 'admin-1' });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toMatchObject({ impersonatedBy: 'admin-1' });
  });

  it.each(['POST', 'PATCH', 'PUT', 'DELETE'])('refuses %s from an admin view of the account', async (method) => {
    const { guard, context } = setup({ impersonatedBy: 'admin-1', method });
    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('refuses admins and inactive accounts', async () => {
    await expect(setup({ role: 'SUPER_ADMIN' }).guard.canActivate(setup({ role: 'SUPER_ADMIN' }).context)).rejects.toThrow(UnauthorizedException);
    const suspended = setup({ status: 'SUSPENDED' });
    await expect(suspended.guard.canActivate(suspended.context)).rejects.toThrow(UnauthorizedException);
  });
});
