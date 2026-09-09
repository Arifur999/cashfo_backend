import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AdminRole } from '@prisma/client';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator.js';
import { Roles } from '../admin-auth/decorators/roles.decorator.js';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard.js';
import { RolesGuard } from '../admin-auth/guards/roles.guard.js';
import type { RequestAdminUser } from '../admin-auth/interfaces/request-admin-user.interface.js';
import { BanUserDto } from './dto/ban-user.dto.js';
import { ChangePlanDto } from './dto/change-plan.dto.js';
import { ListPlatformUsersQueryDto } from './dto/list-platform-users-query.dto.js';
import { SuspendUserDto } from './dto/suspend-user.dto.js';
import { PlatformUsersService } from './platform-users.service.js';

// Every route needs authentication; only the moderation actions additionally
// restrict by role via @Roles() (RolesGuard passes routes with no @Roles()
// decorator through to any authenticated admin).
@UseGuards(AdminAuthGuard, RolesGuard)
@Controller('admin/users')
export class PlatformUsersController {
  constructor(private readonly platformUsersService: PlatformUsersService) {}

  @Get()
  list(@Query() query: ListPlatformUsersQueryDto) {
    return this.platformUsersService.list(query);
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.platformUsersService.getById(id);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.SUPPORT_ADMIN)
  @Patch(':id/suspend')
  suspend(
    @Param('id') id: string,
    @Body() dto: SuspendUserDto,
    @CurrentAdmin() admin: RequestAdminUser,
    @Req() req: Request,
  ) {
    return this.platformUsersService.suspend(id, dto, admin.id, req.ip);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.SUPPORT_ADMIN)
  @Patch(':id/activate')
  activate(@Param('id') id: string, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.platformUsersService.activate(id, admin.id, req.ip);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.SUPPORT_ADMIN)
  @Patch(':id/ban')
  ban(
    @Param('id') id: string,
    @Body() dto: BanUserDto,
    @CurrentAdmin() admin: RequestAdminUser,
    @Req() req: Request,
  ) {
    return this.platformUsersService.ban(id, dto, admin.id, req.ip);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.SUPPORT_ADMIN)
  @Post(':id/reset-password')
  resetPassword(@Param('id') id: string, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.platformUsersService.resetPassword(id, admin.id, req.ip);
  }

  @Roles(AdminRole.SUPER_ADMIN)
  @Post(':id/impersonate')
  impersonate(@Param('id') id: string, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.platformUsersService.impersonate(id, admin.id, req.ip);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.FINANCE_ADMIN)
  @Patch(':id/change-plan')
  changePlan(
    @Param('id') id: string,
    @Body() dto: ChangePlanDto,
    @CurrentAdmin() admin: RequestAdminUser,
    @Req() req: Request,
  ) {
    return this.platformUsersService.changePlan(id, dto, admin.id, req.ip);
  }
}
