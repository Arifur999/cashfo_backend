import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AdminRole } from '../common/roles.js';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator.js';
import { Roles } from '../admin-auth/decorators/roles.decorator.js';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard.js';
import { RolesGuard } from '../admin-auth/guards/roles.guard.js';
import type { RequestAdminUser } from '../admin-auth/interfaces/request-admin-user.interface.js';
import { CreateNotificationTemplateDto } from './dto/create-notification-template.dto.js';
import { UpdateNotificationTemplateDto } from './dto/update-notification-template.dto.js';
import { NotificationTemplatesService } from './notification-templates.service.js';

@UseGuards(AdminAuthGuard)
@Controller('admin/notifications/templates')
export class NotificationTemplatesController {
  constructor(private readonly notificationTemplatesService: NotificationTemplatesService) {}

  @Get()
  list() {
    return this.notificationTemplatesService.list();
  }

  @UseGuards(RolesGuard)
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
  @Post()
  create(@Body() dto: CreateNotificationTemplateDto, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.notificationTemplatesService.create(dto, admin.id, req.ip);
  }

  @UseGuards(RolesGuard)
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateNotificationTemplateDto, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.notificationTemplatesService.update(id, dto, admin.id, req.ip);
  }

  @UseGuards(RolesGuard)
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.notificationTemplatesService.remove(id, admin.id, req.ip);
  }
}
