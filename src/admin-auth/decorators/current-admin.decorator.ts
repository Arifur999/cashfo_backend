import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { RequestAdminUser } from '../interfaces/request-admin-user.interface.js';

// Reads the admin attached to the request by AdminAuthGuard. Only usable on
// routes that already have @UseGuards(AdminAuthGuard) applied.
export const CurrentAdmin = createParamDecorator((_data: unknown, ctx: ExecutionContext): RequestAdminUser => {
  const request = ctx.switchToHttp().getRequest();
  return request.adminUser;
});
