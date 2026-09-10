import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { RequestBusinessMember } from '../interfaces/request-business-member.interface.js';

// Reads the membership attached by BusinessMembershipGuard. Only usable on
// routes already decorated with @RequireBusinessMembership().
export const CurrentBusinessMember = createParamDecorator((_data: unknown, ctx: ExecutionContext): RequestBusinessMember => {
  const request = ctx.switchToHttp().getRequest();
  return request.businessMember;
});
