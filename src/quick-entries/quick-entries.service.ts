import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Account, AccountType, Prisma } from '@prisma/client';
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
type PostedEntry = Awaited<ReturnType<TransactionsService['createTransaction']>>;

@Injectable()
export class QuickEntriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactionsService: TransactionsService,
  ) {}

  async createIncome(businessId: string, dto: CreateIncomeDto, userId: string, tx?: Prisma.TransactionClient): Promise<PostedEntry> {
    // A charge is posted with it, in one database transaction.
    if (dto.charge && !tx) return this.prisma.$transaction((client) => this.createIncome(businessId, dto, userId, client));
    const toAccount = await this.requireMoneyAccount(businessId, dto.toAccountId, 'toAccountId');
    const incomeAccountId = dto.incomeAccountId ?? (await this.getDefaultIncomeAccountId(businessId));
    const incomeAccount = await this.requireAccountOfType(businessId, incomeAccountId, 'INCOME', 'incomeAccountId');

    const posted = await this.transactionsService.createTransaction(
      businessId,
      {
        transactionType: 'INCOME',
        transactionDate: dto.date,
        description: dto.description,
        referenceNo: dto.referenceNo,
        contactId: dto.contactId,
        entries: [
          { accountId: toAccount.id, entryType: 'DEBIT', amount: dto.amount },
          { accountId: incomeAccount.id, entryType: 'CREDIT', amount: dto.amount, categoryId: dto.categoryId, note: dto.note },
        ],
      },
      userId,
      tx,
    );
    if (dto.charge && tx) {
      await this.transactionsService.postCharge(
        tx,
        businessId,
        posted.id,
        { amount: dto.charge, moneyAccountId: toAccount.id, date: dto.date, contactId: dto.contactId },
        userId,
      );
    }
    return posted;
  }

  async createExpense(businessId: string, dto: CreateExpenseDto, userId: string, tx?: Prisma.TransactionClient): Promise<PostedEntry> {
    if (dto.charge && !tx) return this.prisma.$transaction((client) => this.createExpense(businessId, dto, userId, client));
    const fromAccount = await this.requireMoneyAccount(businessId, dto.fromAccountId, 'fromAccountId');
    const expenseAccount = await this.requireAccountOfType(businessId, dto.expenseAccountId, 'EXPENSE', 'expenseAccountId');

    const posted = await this.transactionsService.createTransaction(
      businessId,
      {
        transactionType: 'EXPENSE',
        transactionDate: dto.date,
        description: dto.description,
        referenceNo: dto.referenceNo,
        contactId: dto.contactId,
        entries: [
          { accountId: expenseAccount.id, entryType: 'DEBIT', amount: dto.amount, categoryId: dto.categoryId, note: dto.note },
          { accountId: fromAccount.id, entryType: 'CREDIT', amount: dto.amount },
        ],
      },
      userId,
      tx,
    );
    if (dto.charge && tx) {
      await this.transactionsService.postCharge(
        tx,
        businessId,
        posted.id,
        { amount: dto.charge, moneyAccountId: fromAccount.id, date: dto.date, contactId: dto.contactId },
        userId,
      );
    }
    return posted;
  }

  async createTransfer(businessId: string, dto: CreateTransferDto, userId: string, tx?: Prisma.TransactionClient) {
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
      tx,
    );
  }

  // Editing an entry (decision D2): the original is voided with the reason
  // 'Corrected' and the corrected one posted in the same database
  // transaction, so the balances never show both or neither. An entry stays
  // the kind it was; the void itself refuses a reversal, an entry already
  // voided and one another feature (a savings goal, an asset) keeps.
  correctIncome(businessId: string, transactionId: string, dto: CreateIncomeDto, userId: string) {
    return this.correct(businessId, transactionId, 'INCOME', userId, (tx) => this.createIncome(businessId, dto, userId, tx));
  }

  correctExpense(businessId: string, transactionId: string, dto: CreateExpenseDto, userId: string) {
    return this.correct(businessId, transactionId, 'EXPENSE', userId, (tx) => this.createExpense(businessId, dto, userId, tx));
  }

  correctTransfer(businessId: string, transactionId: string, dto: CreateTransferDto, userId: string) {
    return this.correct(businessId, transactionId, 'TRANSFER', userId, (tx) => this.createTransfer(businessId, dto, userId, tx));
  }

  private correct<T extends { id: string }>(
    businessId: string,
    transactionId: string,
    kind: 'INCOME' | 'EXPENSE' | 'TRANSFER',
    userId: string,
    post: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const original = await tx.transaction.findUnique({ where: { id: transactionId }, select: { businessId: true, transactionType: true } });
      if (!original || original.businessId !== businessId) {
        throw new NotFoundException('Transaction not found');
      }
      if (original.transactionType !== kind) {
        throw new BadRequestException(`This entry is not a ${kind.toLowerCase()}, so it can't be corrected as one`);
      }
      await this.transactionsService.voidTransaction(businessId, transactionId, 'Corrected', userId, tx);
      const corrected = await post(tx);
      // So History can say what it corrected (and the original, what replaced it).
      await tx.transaction.update({ where: { id: corrected.id }, data: { correctedFromId: transactionId } });
      return { ...corrected, correctedFromId: transactionId };
    });
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
      // Oldest first among equal display orders: accounts a user adds
      // default to 0 too, and the seeded one should win the tie.
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
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
