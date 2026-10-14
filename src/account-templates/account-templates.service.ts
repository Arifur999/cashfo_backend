import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AccountType, DefaultAccountTemplate } from '@prisma/client';
import { RESERVED_ACCOUNT_SUBTYPES } from '../accounts/accounts.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateAccountTemplateDto } from './dto/create-account-template.dto.js';
import { UpdateAccountTemplateDto } from './dto/update-account-template.dto.js';

// Templates every new workspace's Dena-Pawna and Loan Management post
// through (Accounts Receivable/Payable): deactivating one, re-typing it or
// dropping a workspace type from it would leave every workspace created
// afterwards without the account, and every sale or loan there failing.
const isLoadBearing = (template: DefaultAccountTemplate) => !!template.accountSubtype && RESERVED_ACCOUNT_SUBTYPES.includes(template.accountSubtype);
const LOAD_BEARING_MESSAGE =
  'This template seeds the Accounts Receivable/Payable every workspace posts through, so it cannot be deactivated, re-typed or removed from a workspace type. Its name can still change.';

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

  async create(dto: CreateAccountTemplateDto) {
    if (dto.accountSubtype && RESERVED_ACCOUNT_SUBTYPES.includes(dto.accountSubtype)) {
      throw new BadRequestException(`"${dto.accountSubtype}" is reserved for the account the app already seeds.`);
    }
    if (dto.parentId) await this.requireParent(dto.parentId, dto.accountType);
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

    if (isLoadBearing(existing)) {
      const changesShape =
        (dto.accountType !== undefined && dto.accountType !== existing.accountType) ||
        (dto.accountSubtype !== undefined && dto.accountSubtype !== existing.accountSubtype) ||
        dto.isActive === false ||
        (dto.appliesTo !== undefined && existing.appliesTo.some((type) => !dto.appliesTo!.includes(type)));
      if (changesShape) {
        throw new BadRequestException(LOAD_BEARING_MESSAGE);
      }
    } else if (dto.accountSubtype && RESERVED_ACCOUNT_SUBTYPES.includes(dto.accountSubtype)) {
      throw new BadRequestException(`"${dto.accountSubtype}" is reserved for the account the app already seeds.`);
    }
    if (dto.parentId) {
      if (dto.parentId === id) throw new BadRequestException('A template cannot be its own parent');
      await this.requireParent(dto.parentId, dto.accountType ?? existing.accountType);
      const children = await this.prisma.defaultAccountTemplate.count({ where: { parentId: id } });
      if (children > 0) throw new BadRequestException('A template with sub-accounts cannot be moved under another one');
    }

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
    const existing = await this.requireTemplate(id);
    if (isLoadBearing(existing)) {
      throw new BadRequestException(LOAD_BEARING_MESSAGE);
    }

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

  // Templates nest one level deep, under a top-level template of the same
  // type -- the shape seedDefaultAccounts() copies into every workspace.
  private async requireParent(parentId: string, accountType: AccountType) {
    const parent = await this.prisma.defaultAccountTemplate.findUnique({ where: { id: parentId } });
    if (!parent) throw new BadRequestException('Parent template not found');
    if (parent.parentId) throw new BadRequestException('Templates nest one level deep -- pick a top-level parent');
    if (parent.accountType !== accountType) throw new BadRequestException(`The parent must also be of type ${accountType}`);
  }

  private async requireTemplate(id: string) {
    const template = await this.prisma.defaultAccountTemplate.findUnique({ where: { id } });
    if (!template) {
      throw new NotFoundException('Account template not found');
    }
    return template;
  }
}
