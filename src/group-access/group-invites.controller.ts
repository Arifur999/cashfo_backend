import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { ClientInfo } from '../auth/auth-sessions.service.js';
import { GroupMemberRoute } from '../business-access/decorators/group-member-route.decorator.js';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import { UserAuthGuard } from '../user-auth/guards/user-auth.guard.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { AcceptAccessLinkDto } from './dto/group-access.dto.js';
import { GroupAccessService } from './group-access.service.js';

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const clientOf = (req: Request): ClientInfo => ({ ipAddress: req.ip, userAgent: req.headers['user-agent'] });

// The member's side of an access link (/join/<token> in the app). Reading
// and using one needs no sign-in -- the link is the proof -- so both are
// throttled per IP; tokens are 32 random bytes, so guessing is hopeless
// anyway. Adding the group to a signed-in account needs that sign-in.
@Controller('api/group-invites')
export class GroupInvitesController {
  constructor(private readonly access: GroupAccessService) {}

  @Throttle({ default: { limit: 30, ttl: FIFTEEN_MINUTES } })
  @Get(':token')
  preview(@Param('token') token: string) {
    return this.access.preview(token);
  }

  // Makes the login (or sets the new password) and signs in: the answer is
  // a sign-in's, plus the group to open.
  @Throttle({ default: { limit: 10, ttl: FIFTEEN_MINUTES } })
  @Post(':token/accept')
  accept(@Param('token') token: string, @Body() dto: AcceptAccessLinkDto, @Req() req: Request) {
    return this.access.accept(token, dto, clientOf(req));
  }

  @Throttle({ default: { limit: 10, ttl: FIFTEEN_MINUTES } })
  @UseGuards(UserAuthGuard)
  @GroupMemberRoute()
  @Post(':token/attach')
  attach(@Param('token') token: string, @CurrentUser() user: RequestUser) {
    return this.access.attach(token, user.id);
  }
}
