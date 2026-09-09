import { Body, Controller, Get, Param, ParseEnumPipe, Patch, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AdminRole, LegalDocType } from '@prisma/client';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator.js';
import { Roles } from '../admin-auth/decorators/roles.decorator.js';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard.js';
import { RolesGuard } from '../admin-auth/guards/roles.guard.js';
import type { RequestAdminUser } from '../admin-auth/interfaces/request-admin-user.interface.js';
import { UpdateLegalDocumentDto } from './dto/update-legal-document.dto.js';
import { LegalDocumentsService } from './legal-documents.service.js';

@UseGuards(AdminAuthGuard, RolesGuard)
@Controller('admin/config/legal')
export class LegalDocumentsController {
  constructor(private readonly legalDocumentsService: LegalDocumentsService) {}

  @Get()
  list() {
    return this.legalDocumentsService.list();
  }

  @Get(':type')
  getByType(@Param('type', new ParseEnumPipe(LegalDocType)) type: LegalDocType) {
    return this.legalDocumentsService.getByType(type);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
  @Patch(':type')
  update(
    @Param('type', new ParseEnumPipe(LegalDocType)) type: LegalDocType,
    @Body() dto: UpdateLegalDocumentDto,
    @CurrentAdmin() admin: RequestAdminUser,
    @Req() req: Request,
  ) {
    return this.legalDocumentsService.update(type, dto, admin.id, req.ip);
  }
}
