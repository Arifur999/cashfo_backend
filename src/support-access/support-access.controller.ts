import { Controller, Delete, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import { UserAuthGuard } from '../user-auth/guards/user-auth.guard.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { SupportAccessService } from './support-access.service.js';

// The customer's side of "View as customer": Settings > Security makes a
// code to read out to support, shows whether one is waiting, and can take it
// back. A support view is read-only (UserAuthGuard refuses its writes), so
// only the customer themself can make or withdraw a code.
@UseGuards(UserAuthGuard)
@Controller('api/auth/support-access')
export class SupportAccessController {
  constructor(private readonly supportAccess: SupportAccessService) {}

  @Get()
  status(@CurrentUser() user: RequestUser) {
    return this.supportAccess.status(user.id);
  }

  @Throttle({ default: { limit: 5, ttl: 15 * 60 * 1000 } })
  @Post()
  create(@CurrentUser() user: RequestUser) {
    return this.supportAccess.create(user.id);
  }

  @Delete()
  revoke(@CurrentUser() user: RequestUser, @Req() req: Request) {
    return this.supportAccess.revoke(user.id, req.ip);
  }
}
