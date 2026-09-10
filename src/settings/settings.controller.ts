import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AdminRole } from '@prisma/client';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator.js';
import { Roles } from '../admin-auth/decorators/roles.decorator.js';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard.js';
import { RolesGuard } from '../admin-auth/guards/roles.guard.js';
import type { RequestAdminUser } from '../admin-auth/interfaces/request-admin-user.interface.js';
import { UpdateSettingsDto } from './dto/update-settings.dto.js';
import { SettingsService } from './settings.service.js';

@UseGuards(AdminAuthGuard, RolesGuard)
@Controller('admin/settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  // Any authenticated admin can read settings (e.g. to see whether
  // maintenance mode is on) -- only editing is SUPER_ADMIN only.
  @Get()
  get() {
    return this.settingsService.get();
  }

  @Roles(AdminRole.SUPER_ADMIN)
  @Patch()
  update(@Body() dto: UpdateSettingsDto, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.settingsService.update(dto, admin.id, req.ip);
  }
}
