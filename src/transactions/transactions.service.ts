import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Account, EntryType, Prisma } from '@prisma/client';
import { AccountBalanceService } from '../accounts/account-balance.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateTransactionDto } from './dto/create-transaction.dto.js';
import { CreateTransactionEntryDto } from './dto/create-transaction-entry.dto.js';
import { ListTransactionsQueryDto } from './dto/list-transactions-query.dto.js';

@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accountBalanceService: AccountBalanceService,
  ) {}

  // The heart of the whole system -- every future money-moving feature
  // (Income/Expense, Transfer, Receivable/Payable, ...) calls this rather
  // than writing Transaction/TransactionEntry rows directly. Every check
  // below is deliberately done in THIS service, not trusted from the DTO
  // layer alone -- see each private helper's comment for why.
  async createTransaction(businessId: string, dto: CreateTransactionDto, userId: string) {
    // Idempotency check FIRST: a double-click/network-retry should short-
    // circuit before any other work. Silent success with the existing
    // record -- this is the whole point of idempotency, not an error.
    if (dto.idempotencyKey) {
      const existing = await this.prisma.transaction.findUnique({
        where: { idempotencyKey: dto.idempotencyKey },
        include: { entries: true },
      });
      if (existing) {
        if (existing.businessId !== businessId) {
          // Astronomically unlikely with a client-generated key (e.g. a
          // UUID), but the key is unique table-wide, not per-business --
          // never silently hand back another workspace's transaction.
          throw new ConflictException('This idempotency key was already used in a different workspace');
        }
        return existing;
      }
    }

    this.validateEntryShape(dto.entries);

    const distinctAccountIds = [...new Set(dto.entries.map((e) => e.accountId))];
    const accounts = await this.prisma.account.findMany({ where: { id: { in: distinctAccountIds } } });
    this.requireAccountsBelongToBusiness(accounts, distinctAccountIds, businessId);

    const { debitTotal, creditTotal } = this.sumEntries(dto.entries);
    if (!debitTotal.equals(creditTotal)) {
      throw new BadRequestException(`Debits (${debitTotal.toFixed(2)}) must equal credits (${creditTotal.toFixed(2)})`);
    }

    return this.prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.create({
        data: {
          businessId,
          transactionType: dto.transactionType,
          transactionDate: new Date(dto.transactionDate),
          referenceNo: dto.referenceNo,
          description: dto.description,
          contactId: dto.contactId,
          idempotencyKey: dto.idempotencyKey,
          createdBy: userId,
          entries: {
            create: dto.entries.map((e) => ({
              accountId: e.accountId,
              entryType: e.entryType,
              amount: e.amount,
              categoryId: e.categoryId,
              note: e.note,
            })),
          },
        },
        include: { entries: true },
      });

      // Recalculated INSIDE this same transaction -- the cached balance
      // must never be visibly stale even between this commit and the next
      // read, and a rollback here rolls the balance update back too.
      for (const accountId of distinctAccountIds) {
        await this.accountBalanceService.recalculateBalance(accountId, tx);
      }

      return transaction;
    });
  }

  // NEVER hard-deletes. Marks the original VOIDED and creates a brand new
  // reversing Transaction whose entries are the exact mirror of the
  // original (DEBIT<->CREDIT swapped, same accounts/amounts) -- this is
  // what actually restores the affected accounts' balances, since
  // recalculateBalance() only sums POSTED entries and the original's
  // entries still exist (voiding doesn't touch them) but its Transaction's
  // status flips to VOIDED, so they stop counting; the reversal's entries
  // then count in their place, net effect zero.
  //
  // DESIGN DECISION: the reversal keeps the SAME transactionType as the
  // original (not a generic JOURNAL) -- an INCOME transaction being voided
  // stays traceable as an INCOME-type row (linked via reversalOfId) rather
  // than losing that context, which matters once reports (Prompt 12+) group
  // by type.
  async voidTransaction(businessId: string, transactionId: string, reason: string, userId: string) {
    const original = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      include: { entries: true },
    });
    if (!original || original.businessId !== businessId) {
      throw new NotFoundException('Transaction not found');
    }
    if (original.status === 'VOIDED') {
      throw new BadRequestException('This transaction has already been voided');
    }

    const distinctAccountIds = [...new Set(original.entries.map((e) => e.accountId))];

    return this.prisma.$transaction(async (tx) => {
      await tx.transaction.update({
        where: { id: transactionId },
        data: { status: 'VOIDED', voidedAt: new Date(), voidedReason: reason },
      });

      const reversal = await tx.transaction.create({
        data: {
          businessId,
          transactionType: original.transactionType,
          transactionDate: new Date(),
          description: `Reversal of: ${original.description ?? original.referenceNo ?? original.id}`,
          referenceNo: original.referenceNo,
          contactId: original.contactId,
          createdBy: userId,
          reversalOfId: original.id,
          entries: {
            create: original.entries.map((e) => ({
              accountId: e.accountId,
              entryType: this.flip(e.entryType),
              amount: e.amount,
              categoryId: e.categoryId,
              note: e.note,
            })),
          },
        },
        include: { entries: true },
      });

      for (const accountId of distinctAccountIds) {
        await this.accountBalanceService.recalculateBalance(accountId, tx);
      }

      return { original: { id: original.id, status: 'VOIDED' as const }, reversal };
    });
  }

  async getTransaction(businessId: string, transactionId: string) {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      include: { entries: { include: { account: { select: { id: true, name: true, accountType: true } } } } },
    });
    if (!transaction || transaction.businessId !== businessId) {
      throw new NotFoundException('Transaction not found');
    }
    return transaction;
  }

  async listTransactions(businessId: string, filters: ListTransactionsQueryDto) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;

    const where: Prisma.TransactionWhereInput = { businessId };

    if (filters.dateFrom || filters.dateTo) {
      where.transactionDate = {
        ...(filters.dateFrom && { gte: new Date(filters.dateFrom) }),
        ...(filters.dateTo && { lte: new Date(filters.dateTo) }),
      };
    }
    if (filters.transactionType) where.transactionType = filters.transactionType;
    if (filters.status) where.status = filters.status;
    if (filters.accountId) where.entries = { some: { accountId: filters.accountId } };
    if (filters.search) {
      where.OR = [
        { description: { contains: filters.search, mode: 'insensitive' } },
        { referenceNo: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        include: { entries: true },
        orderBy: [{ transactionDate: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  // Defensive re-validation of what CreateTransactionEntryDto's decorators
  // already check -- the service is the real boundary, not the DTO (a
  // future internal caller, e.g. a Prompt 6 Income/Expense wrapper, could
  // in principle construct this input without ever going through
  // class-validator).
  private validateEntryShape(entries: CreateTransactionEntryDto[]) {
    if (entries.length < 2) {
      throw new BadRequestException('A transaction needs at least 2 entries');
    }
    for (const entry of entries) {
      if (!(Number(entry.amount) > 0)) {
        throw new BadRequestException('Every entry amount must be greater than zero');
      }
    }
  }

  private requireAccountsBelongToBusiness(accounts: Account[], requestedIds: string[], businessId: string) {
    if (accounts.length !== requestedIds.length) {
      throw new BadRequestException('One or more accounts do not exist');
    }
    const foreign = accounts.find((a) => a.businessId !== businessId);
    if (foreign) {
      throw new BadRequestException(`Account "${foreign.name}" does not belong to this workspace`);
    }
  }

  // Exact Decimal arithmetic -- never plain JS floats -- for the
  // debits-must-equal-credits invariant.
  private sumEntries(entries: CreateTransactionEntryDto[]) {
    let debitTotal = new Prisma.Decimal(0);
    let creditTotal = new Prisma.Decimal(0);
    for (const entry of entries) {
      if (entry.entryType === 'DEBIT') {
        debitTotal = debitTotal.plus(entry.amount);
      } else {
        creditTotal = creditTotal.plus(entry.amount);
      }
    }
    return { debitTotal, creditTotal };
  }

  private flip(entryType: EntryType): EntryType {
    return entryType === 'DEBIT' ? 'CREDIT' : 'DEBIT';
  }
}
