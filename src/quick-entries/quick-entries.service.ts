import { BadRequestException, Injectable } from '@nestjs/common';
import { Account, AccountType } from '@prisma/client';
import { MONEY_ACCOUNT_SUBTYPES } from '../accounts/accounts.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TransactionsService } from '../transactions/transactions.service.js';
import { CreateExpenseDto } from './dto/create-expense.dto.js';
import { CreateIncomeDto } from './dto/create-income.dto.js';
import { CreateTransferDto } from './dto/create-transfer.dto.js';

// Friendly wrappers over TransactionsService.createTransaction() (Prompt 5)
// for the three most common actions a normal user takes -- none of this
// duplicates the balance/validation logic there; it only figures out the
// right two entries to construct and lets that service do the real work
// (including the debit=credit check, cross-workspace guard, and balance
// recalculation).
@Injectable()
export class QuickEntriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactionsService: TransactionsService,
  ) {}

  async createIncome(businessId: string, dto: CreateIncomeDto, userId: string) {
    const toAccount = await this.requireMoneyAccount(businessId, dto.toAccountId, 'toAccountId');
    const incomeAccountId = dto.incomeAccountId ?? (await this.getDefaultIncomeAccountId(businessId));
    const incomeAccount = await this.requireAccountOfType(businessId, incomeAccountId, 'INCOME', 'incomeAccountId');

    return this.transactionsService.createTransaction(
      businessId,
      {
        transactionType: 'INCOME',
        transactionDate: dto.date,
        description: dto.description,
        entries: [
          { accountId: toAccount.id, entryType: 'DEBIT', amount: dto.amount },
          { accountId: incomeAccount.id, entryType: 'CREDIT', amount: dto.amount, categoryId: dto.categoryId },
        ],
      },
      userId,
    );
  }

  async createExpense(businessId: string, dto: CreateExpenseDto, userId: string) {
    const fromAccount = await this.requireMoneyAccount(businessId, dto.fromAccountId, 'fromAccountId');
    const expenseAccount = await this.requireAccountOfType(businessId, dto.expenseAccountId, 'EXPENSE', 'expenseAccountId');

    return this.transactionsService.createTransaction(
      businessId,
      {
        transactionType: 'EXPENSE',
        transactionDate: dto.date,
        description: dto.description,
        entries: [
          { accountId: expenseAccount.id, entryType: 'DEBIT', amount: dto.amount, categoryId: dto.categoryId },
          { accountId: fromAccount.id, entryType: 'CREDIT', amount: dto.amount },
        ],
      },
      userId,
    );
  }

  async createTransfer(businessId: string, dto: CreateTransferDto, userId: string) {
    if (dto.fromAccountId === dto.toAccountId) {
      throw new BadRequestException('Cannot transfer to the same account');
    }
    const fromAccount = await this.requireMoneyAccount(businessId, dto.fromAccountId, 'fromAccountId');
    const toAccount = await this.requireMoneyAccount(businessId, dto.toAccountId, 'toAccountId');

    return this.transactionsService.createTransaction(
      businessId,
      {
        transactionType: 'TRANSFER',
        transactionDate: dto.date,
        description: dto.description,
        entries: [
          { accountId: toAccount.id, entryType: 'DEBIT', amount: dto.amount },
          { accountId: fromAccount.id, entryType: 'CREDIT', amount: dto.amount },
        ],
      },
      userId,
    );
  }

  // DESIGN DECISION (documented per Prompt 6's explicit request): "the
  // default income account" for a workspace is whichever INCOME-type
  // account has the LOWEST displayOrder. This works without hardcoding any
  // subtype/name string because the seed data (admin panel's
  // DefaultAccountTemplate) already orders each workspace type's primary
  // income source first -- "Sales Income" is displayOrder 0 for BUSINESS
  // workspaces, "Salary Income" is the lowest-displayOrder INCOME account
  // visible to PERSONAL workspaces. If a workspace has no INCOME account at
  // all (only possible if every one was archived, or a custom workspace was
  // built with none), this fails with a clear message asking the caller to
  // specify incomeAccountId explicitly.
  private async getDefaultIncomeAccountId(businessId: string): Promise<string> {
    const account = await this.prisma.account.findFirst({
      where: { businessId, accountType: 'INCOME', status: 'ACTIVE' },
      orderBy: { displayOrder: 'asc' },
    });
    if (!account) {
      throw new BadRequestException('No income account exists in this workspace -- specify incomeAccountId or create one first');
    }
    return account.id;
  }

  private async requireMoneyAccount(businessId: string, accountId: string, field: string): Promise<Account> {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account || account.businessId !== businessId) {
      throw new BadRequestException(`${field}: account not found in this workspace`);
    }
    if (account.accountType !== 'ASSET' || !account.accountSubtype || !MONEY_ACCOUNT_SUBTYPES.includes(account.accountSubtype)) {
      throw new BadRequestException(`${field} must be a cash/bank/mobile-money account`);
    }
    return account;
  }

  private async requireAccountOfType(businessId: string, accountId: string, accountType: AccountType, field: string): Promise<Account> {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account || account.businessId !== businessId) {
      throw new BadRequestException(`${field}: account not found in this workspace`);
    }
    if (account.accountType !== accountType) {
      throw new BadRequestException(`${field} must be a ${accountType} account`);
    }
    return account;
  }
}
