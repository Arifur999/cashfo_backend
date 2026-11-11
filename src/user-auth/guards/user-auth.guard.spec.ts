import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { UserAuthGuard } from './user-auth.guard.js';

const setup = ({ impersonatedBy = null as string | null, method = 'GET', status = 'ACTIVE', role = 'USER', portalOnly = false, groupRoute = false } = {}) => {
  const authenticator = {
    authenticate: vi
      .fn()
      .mockResolvedValue({ user: { id: 'user-1', email: 'user@example.com', role, status, portalOnly }, sessionId: 'session-1', impersonatedBy }),
  };
  const request: Record<string, unknown> = { method };
  const context = { switchToHttp: () => ({ getRequest: () => request }), getHandler: () => null, getClass: () => null } as unknown as ExecutionContext;
  const reflector = { getAllAndOverride: vi.fn().mockReturnValue(groupRoute) };
  return { guard: new UserAuthGuard(authenticator as never, reflector as never), request, context };
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

  it('keeps a member-portal login to the routes open to group members', async () => {
    const outside = setup({ portalOnly: true });
    await expect(outside.guard.canActivate(outside.context)).rejects.toThrow(ForbiddenException);
    const inside = setup({ portalOnly: true, groupRoute: true, method: 'POST' });
    await expect(inside.guard.canActivate(inside.context)).resolves.toBe(true);
  });

  it('lets an ordinary customer use every route', async () => {
    const { guard, context } = setup({ method: 'POST' });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});
