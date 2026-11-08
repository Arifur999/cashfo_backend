import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator.js';
import { Roles } from '../admin-auth/decorators/roles.decorator.js';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard.js';
import { RolesGuard } from '../admin-auth/guards/roles.guard.js';
import type { RequestAdminUser } from '../admin-auth/interfaces/request-admin-user.interface.js';
import { AdminRole } from '../common/roles.js';
import { HelpVideoDto, OrderHelpVideosDto, UpdateHelpCompanyDto, UpdateHelpVideoDto } from './dto/help.dto.js';
import { HelpService } from './help.service.js';

// Settings › Help & support reads this; open during maintenance like the
// rest of api/platform, and without sign-in (it is the company's own card).
@Controller('api/platform/help')
export class HelpController {
  constructor(private readonly help: HelpService) {}

  @Get()
  forUsers() {
    return this.help.forUsers();
  }
}

// Admin › Settings › Company and help page, and Video guides. Every admin
// may look; only a super admin changes them.
@UseGuards(AdminAuthGuard, RolesGuard)
@Controller('admin/help')
export class AdminHelpController {
  constructor(private readonly help: HelpService) {}

  @Get()
  get() {
    return this.help.forAdmin();
  }

  @Roles(AdminRole.SUPER_ADMIN)
  @Put('company')
  updateCompany(@Body() dto: UpdateHelpCompanyDto, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.help.updateCompany(dto, admin.id, req.ip);
  }

  @Roles(AdminRole.SUPER_ADMIN)
  @Post('videos')
  addVideo(@Body() dto: HelpVideoDto, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.help.addVideo(dto, admin.id, req.ip);
  }

  @Roles(AdminRole.SUPER_ADMIN)
  @Put('videos/order')
  order(@Body() dto: OrderHelpVideosDto, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.help.orderVideos(dto, admin.id, req.ip);
  }

  @Roles(AdminRole.SUPER_ADMIN)
  @Patch('videos/:id')
  updateVideo(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateHelpVideoDto, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.help.updateVideo(id, dto, admin.id, req.ip);
  }

  @Roles(AdminRole.SUPER_ADMIN)
  @Delete('videos/:id')
  deleteVideo(@Param('id', ParseUUIDPipe) id: string, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.help.deleteVideo(id, admin.id, req.ip);
  }
}
