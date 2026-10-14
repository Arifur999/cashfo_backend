import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Account, EntryType, Prisma } from '@prisma/client';
import { AccountBalanceService } from '../accounts/account-balance.service.js';
import { REFERRAL_BONUS_INCOME_SUBTYPE } from '../accounts/accounts.service.js';
import { dhakaDateOnly } from '../common/dhaka.js';
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
  //
  // Pass `tx` to post inside a caller's own transaction, so a feature's
  // check, this posting and the feature's own record (a savings entry, an
  // asset's SOLD status, ...) commit or roll back together.
  async createTransaction(businessId: string, dto: CreateTransactionDto, userId: string, tx?: Prisma.TransactionClient) {
    if (tx) return this.post(tx, businessId, dto, userId);
    try {
      return await this.prisma.$transaction((client) => this.post(client, businessId, dto, userId));
    } catch (error) {
      // Two requests with the same idempotency key raced past the lookup
      // below: the loser hits the unique index, and answers with the
      // winner's transaction like any later retry would.
      if (dto.idempotencyKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.post(this.prisma, businessId, dto, userId);
      }
      throw error;
    }
  }

  // Runs `work` in one database transaction holding a lock per key (taken
  // in sorted order, so two calls never wait on each other in a cycle).
  // Check-then-post flows -- withdrawing a goal, selling an asset, paying
  // against a contact's outstanding balance -- run under it, so a double
  // click or a second tab queues behind the first instead of passing the
  // same check and posting the money twice.
  async withLocks<T>(keys: string[], work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      for (const key of [...new Set(keys)].sort()) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      }
      return work(tx);
    });
  }

  private async post(client: Prisma.TransactionClient, businessId: string, dto: CreateTransactionDto, userId: string) {
    // Idempotency check FIRST: a double-click/network-retry should short-
    // circuit before any other work. Silent success with the existing
    // record -- this is the whole point of idempotency, not an error.
    if (dto.idempotencyKey) {
      const existing = await client.transaction.findUnique({
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
    const accounts = await client.account.findMany({ where: { id: { in: distinctAccountIds } } });
    this.requireAccountsBelongToBusiness(accounts, distinctAccountIds, businessId);
    await this.requireLinksBelongToBusiness(client, businessId, dto);

    const { debitTotal, creditTotal } = this.sumEntries(dto.entries);
    if (!debitTotal.equals(creditTotal)) {
      throw new BadRequestException(`Debits (${debitTotal.toFixed(2)}) must equal credits (${creditTotal.toFixed(2)})`);
    }

    await this.lockAccounts(client, distinctAccountIds);

    const transaction = await client.transaction.create({
      data: {
        businessId,
        transactionType: dto.transactionType,
        transactionDate: new Date(dto.transactionDate),
        referenceNo: dto.referenceNo,
        description: dto.description,
        contactId: dto.contactId,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        appliedToTransactionId: dto.appliedToTransactionId,
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
      await this.accountBalanceService.recalculateBalance(accountId, client);
    }

    return transaction;
  }

  // NEVER hard-deletes. Marks the original VOIDED and creates a brand new
  // reversing Transaction whose entries are the exact mirror of the
  // original (DEBIT<->CREDIT swapped, same accounts/amounts) -- this is
  // what actually restores the affected accounts' balances, since
  // recalculateBalance() sums every entry: the original's and the
  // reversal's net to zero.
  //
  // DESIGN DECISION: the reversal keeps the SAME transactionType as the
  // original (not a generic JOURNAL) -- an INCOME transaction being voided
  // stays traceable as an INCOME-type row (linked via reversalOfId) rather
  // than losing that context. Every report, budget and balance breakdown
  // therefore counts only `status: 'POSTED', reversalOfId: null` rows --
  // the voided original and its reversal both drop out.
  //
  // A reversal can't itself be voided (that would quietly re-post the
  // original), and neither can a posting another feature keeps its own
  // record of (a savings goal's deposit or withdrawal, an asset's purchase
  // or sale, a referral payout): voiding only the money would leave that
  // feature's figures saying the opposite of the ledger.
  async voidTransaction(businessId: string, transactionId: string, reason: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const original = await tx.transaction.findUnique({
        where: { id: transactionId },
        include: { entries: true },
      });
      if (!original || original.businessId !== businessId) {
        throw new NotFoundException('Transaction not found');
      }
      if (original.reversalOfId) {
        throw new BadRequestException('This is the reversal of a voided transaction and cannot be voided itself');
      }
      if (original.status === 'VOIDED') {
        throw new BadRequestException('This transaction has already been voided');
      }
      await this.requireNotOwnedByAFeature(tx, original);

      const distinctAccountIds = [...new Set(original.entries.map((e) => e.accountId))];
      await this.lockAccounts(tx, distinctAccountIds);

      // Claimed with a condition, not just updated: of two voids racing
      // past the status check above, only one flips POSTED -> VOIDED; the
      // other stops here instead of posting a second reversal.
      const claimed = await tx.transaction.updateMany({
        where: { id: transactionId, status: 'POSTED' },
        data: { status: 'VOIDED', voidedAt: new Date(), voidedReason: reason },
      });
      if (claimed.count === 0) {
        throw new BadRequestException('This transaction has already been voided');
      }

      const reversal = await tx.transaction.create({
        data: {
          businessId,
          transactionType: original.transactionType,
          transactionDate: dhakaDateOnly(new Date()),
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

  // Locks the accounts' rows (in id order, so two postings over the same
  // accounts never deadlock) until the transaction ends. Without it two
  // postings to one wallet each sum the entries they can see and the
  // second overwrites the first's cached balance, losing a posting.
  private async lockAccounts(client: Prisma.TransactionClient, accountIds: string[]) {
    const ids = [...new Set(accountIds)].sort();
    if (ids.length === 0) return;
    await client.$queryRaw`SELECT id FROM "Account" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
  }

  // A contact or the invoice a payment settles must be this workspace's
  // own -- otherwise a posting could name another workspace's contact (and
  // show its name in this workspace's lists).
  private async requireLinksBelongToBusiness(client: Prisma.TransactionClient, businessId: string, dto: CreateTransactionDto) {
    if (dto.contactId) {
      const contact = await client.contact.findFirst({ where: { id: dto.contactId, businessId }, select: { id: true } });
      if (!contact) throw new BadRequestException('Contact not found in this workspace');
    }
    if (dto.appliedToTransactionId) {
      const target = await client.transaction.findFirst({
        where: { id: dto.appliedToTransactionId, businessId },
        select: { contactId: true },
      });
      if (!target || (dto.contactId && target.contactId !== dto.contactId)) {
        throw new BadRequestException('appliedToTransactionId does not reference a transaction of this contact in this workspace');
      }
    }
  }

  private async requireNotOwnedByAFeature(client: Prisma.TransactionClient, transaction: { id: string; entries: { accountId: string }[] }) {
    const savingsEntry = await client.savingsGoalEntry.findFirst({ where: { transactionId: transaction.id }, select: { id: true } });
    if (savingsEntry) {
      throw new BadRequestException('This transaction belongs to a savings goal, so it cannot be voided here.');
    }
    const asset = await client.asset.findFirst({
      where: { OR: [{ purchaseTransactionId: transaction.id }, { soldTransactionId: transaction.id }] },
      select: { id: true },
    });
    if (asset) {
      throw new BadRequestException('This transaction is an asset purchase or sale, so it cannot be voided here.');
    }
    const referralPayout = await client.account.count({
      where: { id: { in: transaction.entries.map((e) => e.accountId) }, accountSubtype: REFERRAL_BONUS_INCOME_SUBTYPE },
    });
    if (referralPayout > 0) {
      throw new BadRequestException('A referral earnings withdrawal cannot be voided.');
    }
  }

  async getTransaction(businessId: string, transactionId: string) {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      include: { entries: { include: { account: { select: { id: true, name: true, accountType: true, accountSubtype: true } } } } },
    });
    if (!transaction || transaction.businessId !== businessId) {
      throw new NotFoundException('Transaction not found');
    }
    const [withFlag] = await this.withVoidable([transaction]);
    return withFlag;
  }

  // `voidable` on every transaction the API returns: whether voidTransaction()
  // would accept it -- still POSTED, not itself a reversal, and not a
  // posting a savings goal, an asset or a referral payout keeps its own
  // record of. The UI shows Void only where this is true.
  private async withVoidable<T extends { id: string; status: string; reversalOfId: string | null; entries: { account: { accountSubtype: string | null } }[] }>(
    transactions: T[],
  ): Promise<(T & { voidable: boolean })[]> {
    const ids = transactions.map((t) => t.id);
    const [savingsEntries, assets] =
      ids.length === 0
        ? [[], []]
        : await Promise.all([
            this.prisma.savingsGoalEntry.findMany({ where: { transactionId: { in: ids } }, select: { transactionId: true } }),
            this.prisma.asset.findMany({
              where: { OR: [{ purchaseTransactionId: { in: ids } }, { soldTransactionId: { in: ids } }] },
              select: { purchaseTransactionId: true, soldTransactionId: true },
            }),
          ]);
    const owned = new Set<string | null>([
      ...savingsEntries.map((e) => e.transactionId),
      ...assets.flatMap((a) => [a.purchaseTransactionId, a.soldTransactionId]),
    ]);
    return transactions.map((t) => ({
      ...t,
      voidable:
        t.status === 'POSTED' && !t.reversalOfId && !owned.has(t.id) && !t.entries.some((e) => e.account.accountSubtype === REFERRAL_BONUS_INCOME_SUBTYPE),
    }));
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
    else if (filters.transactionTypes?.length) where.transactionType = { in: filters.transactionTypes };
    if (filters.status) where.status = filters.status;
    if (filters.accountId || filters.categoryId) {
      where.entries = { some: { ...(filters.accountId && { accountId: filters.accountId }), ...(filters.categoryId && { categoryId: filters.categoryId }) } };
    }
    if (filters.contactId) where.contactId = filters.contactId;
    if (filters.contactCategory) where.contact = { category: filters.contactCategory };
    if (filters.search) {
      // Quick entries keep what the customer typed on the entry (its note
      // and category), not on the transaction's description.
      const contains = { contains: filters.search, mode: 'insensitive' } as const;
      where.OR = [
        { description: contains },
        { referenceNo: contains },
        { entries: { some: { note: contains } } },
        { entries: { some: { categoryId: contains } } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        // entries.account: same shape as getTransaction()'s single-record
        // include -- the Balance Transfer page (and any other list-level UI
        // that needs to show which accounts were involved, not just an
        // amount) needs entry.account.name without a second round trip per
        // row. contact: the Loan Management Transactions page needs the
        // Bank/Person name per row too.
        include: {
          entries: { include: { account: { select: { id: true, name: true, accountType: true, accountSubtype: true } } } },
          contact: { select: { id: true, name: true } },
        },
        orderBy: [{ transactionDate: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return { data: await this.withVoidable(data), meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
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
