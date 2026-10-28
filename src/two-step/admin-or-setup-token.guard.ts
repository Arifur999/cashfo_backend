import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard.js';
import type { RequestAdminUser } from '../admin-auth/interfaces/request-admin-user.interface.js';
import { TwoStepService } from './two-step.service.js';

export type SetupRequest = Request & { adminUser?: RequestAdminUser; twoStepSetupUserId?: string };

// Two-step set-up for a signed-in admin (an access token, AdminAuthGuard),
// or for one who must set it up before getting in at all: the setupToken in
// the body, which the sign-in answered with after the password checked out.
@Injectable()
export class AdminOrSetupTokenGuard implements CanActivate {
  constructor(
    private readonly adminAuthGuard: AdminAuthGuard,
    private readonly twoStep: TwoStepService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<SetupRequest>();
    const setupToken: unknown = request.body?.setupToken;
    if (typeof setupToken === 'string' && setupToken.length > 0) {
      request.twoStepSetupUserId = await this.twoStep.setupTokenOwner(setupToken);
      return true;
    }
    return this.adminAuthGuard.canActivate(context);
  }
}
