import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AdminRole } from '../common/roles.js';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator.js';
import { Roles } from '../admin-auth/decorators/roles.decorator.js';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard.js';
import { RolesGuard } from '../admin-auth/guards/roles.guard.js';
import type { RequestAdminUser } from '../admin-auth/interfaces/request-admin-user.interface.js';
import { CreateNotificationTemplateDto } from './dto/create-notification-template.dto.js';
import { UpdateNotificationTemplateDto } from './dto/update-notification-template.dto.js';
import { SendTemplateTestDto } from './dto/send-template-test.dto.js';
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

  // Emails only the admin asking, so any admin who can edit templates may.
  @UseGuards(RolesGuard)
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
  @Throttle({ default: { limit: 5, ttl: 60 * 1000 } })
  @Post(':id/test')
  sendTest(@Param('id') id: string, @Body() dto: SendTemplateTestDto, @CurrentAdmin() admin: RequestAdminUser) {
    return this.notificationTemplatesService.sendTest(id, admin.id, dto.language);
  }

  @UseGuards(RolesGuard)
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.notificationTemplatesService.remove(id, admin.id, req.ip);
  }
}
