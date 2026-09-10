import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { RequestPlatformUser } from '../interfaces/request-platform-user.interface.js';

// Reads the platform user attached to the request by PlatformAuthGuard. Only
// usable on routes that already have @UseGuards(PlatformAuthGuard) applied.
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): RequestPlatformUser => {
  const request = ctx.switchToHttp().getRequest();
  return request.platformUser;
});
