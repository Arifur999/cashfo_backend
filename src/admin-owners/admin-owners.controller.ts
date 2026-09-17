import { Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AdminRole } from '@prisma/client';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator.js';
import { Roles } from '../admin-auth/decorators/roles.decorator.js';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard.js';
import { RolesGuard } from '../admin-auth/guards/roles.guard.js';
import type { RequestAdminUser } from '../admin-auth/interfaces/request-admin-user.interface.js';
import { AdminOwnersService } from './admin-owners.service.js';
import { ListOwnersQueryDto } from './dto/list-owners-query.dto.js';

@UseGuards(AdminAuthGuard, RolesGuard)
@Controller('admin/owners')
export class AdminOwnersController {
  constructor(private readonly adminOwnersService: AdminOwnersService) {}

  // No @Roles() -- any authenticated admin can view the list, same
  // convention as AdminWorkspacesController's GET route.
  @Get()
  list(@Query() query: ListOwnersQueryDto) {
    return this.adminOwnersService.list(query);
  }

  // SUPER_ADMIN only -- this permanently wipes a real owner's business/
  // financial data, same bar as AdminUsersController's suspend/ban/reset-password.
  @Roles(AdminRole.SUPER_ADMIN)
  @Post(':userId/reset')
  reset(@Param('userId') userId: string, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.adminOwnersService.resetOwnerData(userId, admin.id, req.ip);
  }
}
