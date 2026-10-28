import { Body, Controller, Delete, Get, Param, ParseEnumPipe, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { LegalDocType } from '@prisma/client';
import { AdminRole } from '../common/roles.js';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator.js';
import { Roles } from '../admin-auth/decorators/roles.decorator.js';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard.js';
import { RolesGuard } from '../admin-auth/guards/roles.guard.js';
import type { RequestAdminUser } from '../admin-auth/interfaces/request-admin-user.interface.js';
import { SaveLegalDraftDto, UpdateLegalDraftDto } from './dto/legal-draft.dto.js';
import { UpdateLegalDocumentDto } from './dto/update-legal-document.dto.js';
import { LegalDocumentsService } from './legal-documents.service.js';

const TYPE = new ParseEnumPipe(LegalDocType);

// Content > Legal pages. Any admin reads; SUPER and CONTENT admins write.
// Also reachable as admin/legal-documents, the name the newer screens use.
@UseGuards(AdminAuthGuard, RolesGuard)
@Controller(['admin/config/legal', 'admin/legal-documents'])
export class LegalDocumentsController {
  constructor(private readonly legalDocumentsService: LegalDocumentsService) {}

  @Get()
  list() {
    return this.legalDocumentsService.list();
  }

  @Get(':type')
  getByType(@Param('type', TYPE) type: LegalDocType) {
    return this.legalDocumentsService.getByType(type);
  }

  @Get(':type/versions')
  versions(@Param('type', TYPE) type: LegalDocType) {
    return this.legalDocumentsService.versions(type);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
  @Post(':type/drafts')
  saveDraft(@Param('type', TYPE) type: LegalDocType, @Body() dto: SaveLegalDraftDto, @CurrentAdmin() admin: RequestAdminUser) {
    return this.legalDocumentsService.saveDraft(type, dto, admin.id);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
  @Patch(':type/drafts/:id')
  updateDraft(@Param('type', TYPE) type: LegalDocType, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLegalDraftDto) {
    return this.legalDocumentsService.updateDraft(type, id, dto);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
  @Delete(':type/drafts/:id')
  discardDraft(@Param('type', TYPE) type: LegalDocType, @Param('id', ParseUUIDPipe) id: string) {
    return this.legalDocumentsService.discardDraft(type, id);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
  @Post(':type/versions/:id/publish')
  publish(@Param('type', TYPE) type: LegalDocType, @Param('id', ParseUUIDPipe) id: string, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.legalDocumentsService.publish(type, id, admin.id, req.ip);
  }

  // Publishes straight away (no draft); kept for the older editor.
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
  @Patch(':type')
  update(@Param('type', TYPE) type: LegalDocType, @Body() dto: UpdateLegalDocumentDto, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.legalDocumentsService.update(type, dto, admin.id, req.ip);
  }
}
