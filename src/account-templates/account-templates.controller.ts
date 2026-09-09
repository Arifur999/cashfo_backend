import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AdminRole } from '@prisma/client';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator.js';
import { Roles } from '../admin-auth/decorators/roles.decorator.js';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard.js';
import { RolesGuard } from '../admin-auth/guards/roles.guard.js';
import type { RequestAdminUser } from '../admin-auth/interfaces/request-admin-user.interface.js';
import { AccountTemplatesService } from './account-templates.service.js';
import { CreateAccountTemplateDto } from './dto/create-account-template.dto.js';
import { UpdateAccountTemplateDto } from './dto/update-account-template.dto.js';

@UseGuards(AdminAuthGuard, RolesGuard)
@Controller('admin/config/account-templates')
export class AccountTemplatesController {
  constructor(private readonly accountTemplatesService: AccountTemplatesService) {}

  @Get()
  list() {
    return this.accountTemplatesService.list();
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
  @Post()
  create(@Body() dto: CreateAccountTemplateDto) {
    return this.accountTemplatesService.create(dto);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAccountTemplateDto,
    @CurrentAdmin() admin: RequestAdminUser,
    @Req() req: Request,
  ) {
    return this.accountTemplatesService.update(id, dto, admin.id, req.ip);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
  @Patch(':id/deactivate')
  deactivate(@Param('id') id: string, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.accountTemplatesService.deactivate(id, admin.id, req.ip);
  }
}
