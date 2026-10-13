import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import { UserAuthGuard } from '../user-auth/guards/user-auth.guard.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { PlatformService } from './platform.service.js';

// Both routes stay open during maintenance (see MaintenanceMiddleware): they
// are how the customer app learns it is on.
@Controller('api/platform')
export class PlatformController {
  constructor(private readonly platformService: PlatformService) {}

  @Get('public')
  publicInfo() {
    return this.platformService.publicInfo();
  }

  @UseGuards(UserAuthGuard)
  @Get()
  forCustomer(@CurrentUser() user: RequestUser) {
    return this.platformService.forCustomer(user.id);
  }
}
