import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AdminRole } from '@prisma/client';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator.js';
import { Roles } from '../admin-auth/decorators/roles.decorator.js';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard.js';
import { RolesGuard } from '../admin-auth/guards/roles.guard.js';
import type { RequestAdminUser } from '../admin-auth/interfaces/request-admin-user.interface.js';
import { CreateCampaignDto } from './dto/create-campaign.dto.js';
import { NotificationCampaignsService } from './notification-campaigns.service.js';

@UseGuards(AdminAuthGuard)
@Controller('admin/notifications/campaigns')
export class NotificationCampaignsController {
  constructor(private readonly notificationCampaignsService: NotificationCampaignsService) {}

  @Get()
  list() {
    return this.notificationCampaignsService.list();
  }

  @Post()
  create(@Body() dto: CreateCampaignDto, @CurrentAdmin() admin: RequestAdminUser) {
    return this.notificationCampaignsService.create(dto, admin.id);
  }

  // Sending and cancelling are grouped under the same role restriction --
  // both commit the campaign to an irreversible-ish outcome (actually
  // notifying users, or closing off the option to), matching the spec's
  // "Campaign sending restricted to SUPER_ADMIN/SUPPORT_ADMIN".
  @UseGuards(RolesGuard)
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.SUPPORT_ADMIN)
  @Post(':id/send')
  send(@Param('id') id: string, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.notificationCampaignsService.send(id, admin.id, req.ip);
  }

  @UseGuards(RolesGuard)
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.SUPPORT_ADMIN)
  @Patch(':id/cancel')
  cancel(@Param('id') id: string, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.notificationCampaignsService.cancel(id, admin.id, req.ip);
  }
}
