import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AdminRole } from '@prisma/client';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator.js';
import { Roles } from '../admin-auth/decorators/roles.decorator.js';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard.js';
import { RolesGuard } from '../admin-auth/guards/roles.guard.js';
import type { RequestAdminUser } from '../admin-auth/interfaces/request-admin-user.interface.js';
import { CreateTranslationDto } from './dto/create-translation.dto.js';
import { ListTranslationsQueryDto } from './dto/list-translations-query.dto.js';
import { UpdateTranslationDto } from './dto/update-translation.dto.js';
import { TranslationsService } from './translations.service.js';

@UseGuards(AdminAuthGuard, RolesGuard)
@Controller('admin/config/translations')
export class TranslationsController {
  constructor(private readonly translationsService: TranslationsService) {}

  @Get()
  list(@Query() query: ListTranslationsQueryDto) {
    return this.translationsService.list(query);
  }

  @Get('export')
  export() {
    return this.translationsService.export();
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
  @Post()
  create(@Body() dto: CreateTranslationDto) {
    return this.translationsService.create(dto);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTranslationDto,
    @CurrentAdmin() admin: RequestAdminUser,
    @Req() req: Request,
  ) {
    return this.translationsService.update(id, dto, admin.id, req.ip);
  }
}
