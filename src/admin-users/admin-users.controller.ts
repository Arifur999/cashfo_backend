import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AdminRole } from '@prisma/client';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator.js';
import { Roles } from '../admin-auth/decorators/roles.decorator.js';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard.js';
import { RolesGuard } from '../admin-auth/guards/roles.guard.js';
import type { RequestAdminUser } from '../admin-auth/interfaces/request-admin-user.interface.js';
import { AdminUsersService } from './admin-users.service.js';
import { CreateAdminDto } from './dto/create-admin.dto.js';
import { UpdateAdminDto } from './dto/update-admin.dto.js';

@UseGuards(AdminAuthGuard, RolesGuard)
@Controller('admin/admins')
export class AdminUsersController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

  // No @Roles() -- any authenticated admin can read this; several prior
  // prompts' dropdowns (e.g. ticket assignment) depend on it.
  @Get('assignable')
  listAssignable() {
    return this.adminUsersService.listAssignable();
  }

  @Roles(AdminRole.SUPER_ADMIN)
  @Get()
  list() {
    return this.adminUsersService.list();
  }

  @Roles(AdminRole.SUPER_ADMIN)
  @Post()
  create(@Body() dto: CreateAdminDto, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.adminUsersService.create(dto, admin.id, req.ip);
  }

  @Roles(AdminRole.SUPER_ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAdminDto, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.adminUsersService.update(id, dto, admin.id, req.ip);
  }

  @Roles(AdminRole.SUPER_ADMIN)
  @Patch(':id/suspend')
  suspend(@Param('id') id: string, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.adminUsersService.suspend(id, admin.id, req.ip);
  }

  @Roles(AdminRole.SUPER_ADMIN)
  @Post(':id/reset-password')
  resetPassword(@Param('id') id: string, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.adminUsersService.resetPassword(id, admin.id, req.ip);
  }
}
