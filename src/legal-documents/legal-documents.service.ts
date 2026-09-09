import { Injectable, NotFoundException } from '@nestjs/common';
import { LegalDocType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { UpdateLegalDocumentDto } from './dto/update-legal-document.dto.js';

@Injectable()
export class LegalDocumentsService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.legalDocument.findMany({ orderBy: { type: 'asc' } });
  }

  async getByType(type: LegalDocType) {
    const doc = await this.prisma.legalDocument.findUnique({ where: { type } });
    if (!doc) {
      throw new NotFoundException('Legal document not found');
    }
    return doc;
  }

  async update(type: LegalDocType, dto: UpdateLegalDocumentDto, adminId: string, ipAddress?: string) {
    const existing = await this.getByType(type);

    return this.prisma.$transaction(async (tx) => {
      const result = await tx.legalDocument.update({
        where: { type },
        data: {
          ...(dto.contentEn !== undefined && { contentEn: dto.contentEn }),
          ...(dto.contentBn !== undefined && { contentBn: dto.contentBn }),
          version: existing.version + 1,
          updatedBy: adminId,
        },
      });

      await tx.auditLog.create({
        data: {
          adminUserId: adminId,
          action: 'LEGAL_DOC_UPDATED',
          entityType: 'LegalDocument',
          entityId: result.id,
          oldValue: { version: existing.version },
          newValue: { version: result.version },
          ipAddress,
        },
      });

      return result;
    });
  }
}
