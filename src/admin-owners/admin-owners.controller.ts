import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AdminRole } from '@prisma/client';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator.js';
import { Roles } from '../admin-auth/decorators/roles.decorator.js';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard.js';
import { RolesGuard } from '../admin-auth/guards/roles.guard.js';
import type { RequestAdminUser } from '../admin-auth/interfaces/request-admin-user.interface.js';
import { AdminOwnersService } from './admin-owners.service.js';
import { ChangeOwnerPlanDto } from './dto/change-owner-plan.dto.js';
import { ListOwnersQueryDto } from './dto/list-owners-query.dto.js';
import { SuspendOwnerDto } from './dto/suspend-owner.dto.js';

@UseGuards(AdminAuthGuard, RolesGuard)
@Controller('admin/owners')
export class AdminOwnersController {
  constructor(private readonly adminOwnersService: AdminOwnersService) {}

  // No @Roles() -- any authenticated admin can view the list/detail, same
  // convention as AdminWorkspacesController's GET route.
  @Get()
  list(@Query() query: ListOwnersQueryDto) {
    return this.adminOwnersService.list(query);
  }

  @Get(':userId')
  getById(@Param('userId') userId: string) {
    return this.adminOwnersService.getById(userId);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.SUPPORT_ADMIN)
  @Patch(':userId/suspend')
  suspend(
    @Param('userId') userId: string,
    @Body() dto: SuspendOwnerDto,
    @CurrentAdmin() admin: RequestAdminUser,
    @Req() req: Request,
  ) {
    return this.adminOwnersService.suspend(userId, dto, admin.id, req.ip);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.SUPPORT_ADMIN)
  @Patch(':userId/activate')
  activate(@Param('userId') userId: string, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.adminOwnersService.activate(userId, admin.id, req.ip);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.FINANCE_ADMIN)
  @Patch(':userId/change-plan')
  changePlan(
    @Param('userId') userId: string,
    @Body() dto: ChangeOwnerPlanDto,
    @CurrentAdmin() admin: RequestAdminUser,
    @Req() req: Request,
  ) {
    return this.adminOwnersService.changePlan(userId, dto, admin.id, req.ip);
  }

  // SUPER_ADMIN only -- this permanently wipes a real owner's business/
  // financial data, same bar as AdminUsersController's suspend/ban/reset-password.
  @Roles(AdminRole.SUPER_ADMIN)
  @Post(':userId/reset')
  reset(@Param('userId') userId: string, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.adminOwnersService.resetOwnerData(userId, admin.id, req.ip);
  }
}
