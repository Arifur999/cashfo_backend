import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateAccountTemplateDto } from './dto/create-account-template.dto.js';
import { UpdateAccountTemplateDto } from './dto/update-account-template.dto.js';

@Injectable()
export class AccountTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  // Hierarchical: top-level (no parent) rows with their immediate children
  // nested -- matches the product blueprint's one-level Chart of Accounts
  // grouping (e.g. Assets -> Cash/Bank/...).
  list() {
    return this.prisma.defaultAccountTemplate.findMany({
      where: { parentId: null },
      orderBy: [{ accountType: 'asc' }, { displayOrder: 'asc' }],
      include: { children: { orderBy: { displayOrder: 'asc' } } },
    });
  }

  create(dto: CreateAccountTemplateDto) {
    return this.prisma.defaultAccountTemplate.create({
      data: {
        name: dto.name,
        nameBn: dto.nameBn,
        accountType: dto.accountType,
        accountSubtype: dto.accountSubtype,
        parentId: dto.parentId,
        appliesTo: dto.appliesTo,
        displayOrder: dto.displayOrder ?? 0,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async update(id: string, dto: UpdateAccountTemplateDto, adminId: string, ipAddress?: string) {
    const existing = await this.requireTemplate(id);

    return this.prisma.$transaction(async (tx) => {
      const result = await tx.defaultAccountTemplate.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.nameBn !== undefined && { nameBn: dto.nameBn }),
          ...(dto.accountType !== undefined && { accountType: dto.accountType }),
          ...(dto.accountSubtype !== undefined && { accountSubtype: dto.accountSubtype }),
          ...(dto.parentId !== undefined && { parentId: dto.parentId }),
          ...(dto.appliesTo !== undefined && { appliesTo: dto.appliesTo }),
          ...(dto.displayOrder !== undefined && { displayOrder: dto.displayOrder }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        },
      });

      await tx.auditLog.create({
        data: {
          adminUserId: adminId,
          action: 'ACCOUNT_TEMPLATE_UPDATED',
          entityType: 'DefaultAccountTemplate',
          entityId: id,
          oldValue: existing as unknown as object,
          newValue: result as unknown as object,
          ipAddress,
        },
      });

      return result;
    });
  }

  async deactivate(id: string, adminId: string, ipAddress?: string) {
    await this.requireTemplate(id);

    return this.prisma.$transaction(async (tx) => {
      const result = await tx.defaultAccountTemplate.update({ where: { id }, data: { isActive: false } });
      await tx.auditLog.create({
        data: {
          adminUserId: adminId,
          action: 'ACCOUNT_TEMPLATE_UPDATED',
          entityType: 'DefaultAccountTemplate',
          entityId: id,
          newValue: { isActive: false },
          ipAddress,
        },
      });
      return result;
    });
  }

  private async requireTemplate(id: string) {
    const template = await this.prisma.defaultAccountTemplate.findUnique({ where: { id } });
    if (!template) {
      throw new NotFoundException('Account template not found');
    }
    return template;
  }
}
