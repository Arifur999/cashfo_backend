import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AccountType, Prisma, WorkspaceType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateAccountDto } from './dto/create-account.dto.js';
import { UpdateAccountDto } from './dto/update-account.dto.js';

const ACCOUNT_TYPE_ORDER: AccountType[] = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'];

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  // Copies DefaultAccountTemplate rows (admin panel, Prompt 5 of that plan)
  // into real Account rows for a newly-created Business. Called from
  // UserAuthService.register() (the auto-created default Personal
  // workspace) and BusinessesService.create() (new Business workspaces) --
  // NOT from this module's own controller, so nothing else seeds accounts
  // ad-hoc.
  //
  // Accepts an optional transaction client so callers can include this in
  // their OWN $transaction (both call sites do) -- a user/workspace should
  // never end up existing with no chart of accounts, same all-or-nothing
  // reasoning as Prompt 2's original register() transaction.
  //
  // Two-pass: templates can reference a parentId that's also being copied
  // in this same batch, so all rows are created first (flat, no parent),
  // then a second pass wires up parentId using a templateId -> new-Account-id
  // map. If a template's parent isn't in the filtered set for this
  // workspaceType (shouldn't happen with the current seed data, but not
  // guaranteed by the schema), that account is just left top-level rather
  // than failing the whole seed.
  async seedDefaultAccounts(businessId: string, workspaceType: WorkspaceType, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;

    const templates = await client.defaultAccountTemplate.findMany({
      where: { appliesTo: { has: workspaceType }, isActive: true },
      orderBy: { displayOrder: 'asc' },
    });

    const templateIdToAccountId = new Map<string, string>();
    for (const template of templates) {
      const account = await client.account.create({
        data: {
          businessId,
          name: template.name,
          nameBn: template.nameBn,
          accountType: template.accountType,
          accountSubtype: template.accountSubtype,
          displayOrder: template.displayOrder,
          isSystemAccount: true,
        },
      });
      templateIdToAccountId.set(template.id, account.id);
    }

    for (const template of templates) {
      if (!template.parentId) continue;
      const newParentId = templateIdToAccountId.get(template.parentId);
      const newOwnId = templateIdToAccountId.get(template.id);
      if (newParentId && newOwnId) {
        await client.account.update({ where: { id: newOwnId }, data: { parentId: newParentId } });
      }
    }
  }

  async list(businessId: string) {
    const accounts = await this.prisma.account.findMany({
      where: { businessId },
      orderBy: [{ accountType: 'asc' }, { displayOrder: 'asc' }],
    });

    const byId = new Map(accounts.map((a) => [a.id, { ...a, children: [] as (typeof accounts)[number][] }]));
    const roots: (typeof accounts)[number][] = [];
    for (const account of accounts) {
      const node = byId.get(account.id)!;
      if (account.parentId && byId.has(account.parentId)) {
        byId.get(account.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    // Grouped by accountType in the standard order, each group holding only
    // its ROOT accounts (children are nested inside via `.children`, not
    // repeated at the top level).
    return ACCOUNT_TYPE_ORDER.map((accountType) => ({
      accountType,
      accounts: roots.filter((a) => a.accountType === accountType),
    }));
  }

  async getOne(businessId: string, id: string) {
    return this.requireAccount(businessId, id);
  }

  async create(businessId: string, dto: CreateAccountDto) {
    if (dto.parentId) {
      await this.requireCompatibleParent(businessId, dto.parentId, dto.accountType);
    }

    return this.prisma.account.create({
      data: {
        businessId,
        name: dto.name,
        nameBn: dto.nameBn,
        accountType: dto.accountType,
        accountSubtype: dto.accountSubtype,
        parentId: dto.parentId,
        isSystemAccount: false,
      },
    });
  }

  // accountType is not editable (see UpdateAccountDto) -- the simplest way
  // to guarantee an account's children (which all share ITS type by
  // construction, via requireCompatibleParent()) never end up pointing at a
  // parent of a now-different type is to never let the type change at all,
  // rather than trying to validate every existing child stays consistent.
  async update(businessId: string, id: string, dto: UpdateAccountDto) {
    const account = await this.requireAccount(businessId, id);

    if (dto.parentId !== undefined && dto.parentId !== null) {
      if (dto.parentId === id) {
        throw new BadRequestException('An account cannot be its own parent');
      }
      await this.requireCompatibleParent(businessId, dto.parentId, account.accountType);
    }

    return this.prisma.account.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.nameBn !== undefined && { nameBn: dto.nameBn }),
        ...(dto.accountSubtype !== undefined && { accountSubtype: dto.accountSubtype }),
        ...(dto.parentId !== undefined && { parentId: dto.parentId }),
      },
    });
  }

  async archive(businessId: string, id: string) {
    const account = await this.requireAccount(businessId, id);

    const activeChildCount = await this.prisma.account.count({
      where: { parentId: id, status: 'ACTIVE' },
    });
    if (activeChildCount > 0) {
      throw new BadRequestException('Archive this account\'s child accounts first.');
    }

    // TODO (Prompt 5, once the Transaction Engine exists): also block
    // archiving if this account has any transaction_entries. There are no
    // transactions yet in Prompt 4, so nothing to check here.

    if (account.status === 'ARCHIVED') {
      return account;
    }

    return this.prisma.account.update({ where: { id }, data: { status: 'ARCHIVED' } });
  }

  private async requireCompatibleParent(businessId: string, parentId: string, accountType: AccountType) {
    const parent = await this.prisma.account.findUnique({ where: { id: parentId } });
    if (!parent || parent.businessId !== businessId) {
      throw new BadRequestException('Parent account not found in this workspace');
    }
    if (parent.accountType !== accountType) {
      throw new BadRequestException(`Parent account must also be of type ${accountType}`);
    }
  }

  private async requireAccount(businessId: string, id: string) {
    const account = await this.prisma.account.findUnique({ where: { id } });
    if (!account || account.businessId !== businessId) {
      throw new NotFoundException('Account not found');
    }
    return account;
  }
}
