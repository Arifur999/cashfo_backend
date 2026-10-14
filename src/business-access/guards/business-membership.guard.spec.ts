import { ForbiddenException, HttpException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AllowLockedWorkspace } from '../decorators/allow-locked-workspace.decorator.js';
import { BusinessMembershipGuard } from './business-membership.guard.js';

class Routes {
  open() {}
  @AllowLockedWorkspace()
  verifyPin() {}
}

const setup = ({ pinHash = null as string | null, status = 'ACTIVE', opens = false } = {}) => {
  const prisma = {
    businessMember: {
      findUnique: vi.fn().mockResolvedValue({ businessId: 'biz-1', userId: 'user-1', role: 'OWNER', status, business: { deletedAt: null, pinHash } }),
    },
  };
  const unlocks = { opens: vi.fn().mockReturnValue(opens) };
  const guard = new BusinessMembershipGuard(prisma as never, new Reflector(), unlocks as never);
  const request = {
    params: { businessId: 'biz-1' },
    headers: { 'x-workspace-unlock': 'unlock-token' },
    user: { id: 'user-1', email: 'owner@example.com', sessionId: 'session-1' },
  };
  const context = (handler: keyof Routes = 'open') =>
    ({
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => Routes.prototype[handler],
      getClass: () => Routes,
    }) as unknown as ExecutionContext;
  return { guard, unlocks, request, context };
};

const statusOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return 200;
  } catch (error) {
    return error instanceof HttpException ? error.getStatus() : 500;
  }
};

describe('BusinessMembershipGuard', () => {
  it('lets a member into a workspace without a PIN', async () => {
    const { guard, unlocks, request, context } = setup();
    await expect(guard.canActivate(context())).resolves.toBe(true);
    expect(unlocks.opens).not.toHaveBeenCalled();
    expect(request).toMatchObject({ businessMember: { businessId: 'biz-1', role: 'OWNER' } });
  });

  it('answers 423 for a PIN-locked workspace without its unlock', async () => {
    const { guard, unlocks, context } = setup({ pinHash: 'pin-hash' });
    expect(await statusOf(guard.canActivate(context()))).toBe(423);
    expect(unlocks.opens).toHaveBeenCalledWith('unlock-token', 'user-1', 'session-1', 'biz-1', 'pin-hash');
  });

  it('opens a PIN-locked workspace with its unlock', async () => {
    const { guard, context } = setup({ pinHash: 'pin-hash', opens: true });
    await expect(guard.canActivate(context())).resolves.toBe(true);
  });

  it('lets the PIN itself be entered while locked', async () => {
    const { guard, unlocks, context } = setup({ pinHash: 'pin-hash' });
    await expect(guard.canActivate(context('verifyPin'))).resolves.toBe(true);
    expect(unlocks.opens).not.toHaveBeenCalled();
  });

  it('checks membership before the lock, so outsiders never learn of it', async () => {
    const { guard, context } = setup({ pinHash: 'pin-hash', status: 'REMOVED' });
    await expect(guard.canActivate(context())).rejects.toThrow(ForbiddenException);
  });
});
