import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Account, AccountType, EntryType, Prisma, TransactionType } from '@prisma/client';
import { AccountBalanceService, isDebitPositive } from '../accounts/account-balance.service.js';
import { REFERRAL_BONUS_INCOME_SUBTYPE } from '../accounts/accounts.service.js';
import { dhakaDateOnly } from '../common/dhaka.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateTransactionDto } from './dto/create-transaction.dto.js';
import { CreateTransactionEntryDto } from './dto/create-transaction-entry.dto.js';
import { ListTransactionsQueryDto } from './dto/list-transactions-query.dto.js';

// Still counts: neither a voided original nor the reversal that undid it.
const STANDING_TRANSACTION = { status: 'POSTED', reversalOfId: null } satisfies Prisma.TransactionWhereInput;

// The account each entry names, alike in the list and a single transaction:
// nameBn is the account's Bangla name, null where it has none.
const ENTRY_ACCOUNT_SELECT = { id: true, name: true, nameBn: true, accountType: true, accountSubtype: true } satisfies Prisma.AccountSelect;

// Whether a posting comes at or before another in a running balance: by
// date, then by when it was made.
type Moment = { transactionDate: Date; createdAt: Date };
const atOrBefore = (a: Moment, b: Moment) =>
  a.transactionDate.getTime() < b.transactionDate.getTime() || (a.transactionDate.getTime() === b.transactionDate.getTime() && a.createdAt.getTime() <= b.createdAt.getTime());

// The category a loan entry's charge is filed under (categories are names).
export const CHARGE_CATEGORY = 'Bank charge';
// The charge categories every workspace has without making them (the
// Transfers popup offers them first); any other must be an expense category
// of the workspace.
export const BUILT_IN_CHARGE_CATEGORIES = [CHARGE_CATEGORY, 'Mobile banking fee', 'Service charge'];

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
  //
  // Pass `tx` to void inside a caller's own transaction: correcting an
  // entry voids the old one and posts the new one together.
  async voidTransaction(businessId: string, transactionId: string, reason: string, userId: string, tx?: Prisma.TransactionClient) {
    if (tx) return this.voidIn(tx, businessId, transactionId, reason, userId);
    return this.prisma.$transaction((client) => this.voidIn(client, businessId, transactionId, reason, userId));
  }

  private async voidIn(tx: Prisma.TransactionClient, businessId: string, transactionId: string, reason: string, userId: string) {
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
        // A charge's reversal is the charge's too: lists that leave charges
        // out leave it out as well.
        chargeForId: original.chargeForId,
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

    // A charge paid with this entry goes with it.
    const charges = await tx.transaction.findMany({ where: { businessId, chargeForId: original.id, ...STANDING_TRANSACTION }, select: { id: true } });
    for (const charge of charges) {
      await this.voidIn(tx, businessId, charge.id, reason, userId);
    }

    return { original: { id: original.id, status: 'VOIDED' as const }, reversal };
  }

  // A charge (a bank or service fee) paid with a loan entry, out of the
  // wallet the entry used: an expense of its own in the workspace's first
  // expense account, filed under CHARGE_CATEGORY and tied to the entry, so
  // voiding or correcting the entry takes it too. Posted inside the entry's
  // own database transaction.
  async postCharge(
    tx: Prisma.TransactionClient,
    businessId: string,
    entryId: string,
    charge: { amount: number; moneyAccountId: string; date: string; contactId?: string | null; category?: string | null },
    userId: string,
  ) {
    // A picked category must be a built-in one or one of the workspace's
    // expense categories.
    const category = charge.category?.trim() || CHARGE_CATEGORY;
    if (!BUILT_IN_CHARGE_CATEGORIES.includes(category)) {
      const known = await tx.budgetCategory.findFirst({ where: { businessId, type: 'EXPENSE', name: category }, select: { id: true } });
      if (!known) throw new BadRequestException(`No expense category named "${category}"`);
    }
    const expenseAccount = await tx.account.findFirst({
      where: { businessId, accountType: 'EXPENSE', status: 'ACTIVE' },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true },
    });
    if (!expenseAccount) {
      throw new BadRequestException('No expense account exists in this workspace to file the charge under');
    }
    const posted = await this.createTransaction(
      businessId,
      {
        transactionType: 'EXPENSE',
        transactionDate: charge.date,
        description: 'Charge',
        contactId: charge.contactId ?? undefined,
        entries: [
          { accountId: expenseAccount.id, entryType: 'DEBIT', amount: charge.amount, categoryId: category },
          { accountId: charge.moneyAccountId, entryType: 'CREDIT', amount: charge.amount },
        ],
      },
      userId,
      tx,
    );
    await tx.transaction.update({ where: { id: posted.id }, data: { chargeForId: entryId } });
    return posted;
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
    const zakat = await client.zakatPayment.findUnique({ where: { transactionId: transaction.id }, select: { id: true } });
    if (zakat) {
      throw new BadRequestException('This is zakat you recorded giving. Delete it from the Zakat page.');
    }
  }

  async getTransaction(businessId: string, transactionId: string) {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      include: { entries: { include: { account: { select: ENTRY_ACCOUNT_SELECT } } } },
    });
    if (!transaction || transaction.businessId !== businessId) {
      throw new NotFoundException('Transaction not found');
    }
    const [withFlag] = await this.withVoidable([transaction]);
    // An Edit's two ends: the original this entry corrected, and the entry
    // that corrected this one -- each with its amount, for History.
    const linked = await this.prisma.transaction.findMany({
      where: { businessId, OR: [{ correctedFromId: transaction.id }, ...(transaction.correctedFromId ? [{ id: transaction.correctedFromId }] : [])] },
      select: { id: true, correctedFromId: true, entries: { where: { entryType: EntryType.DEBIT }, select: { amount: true } } },
    });
    const summary = (row: (typeof linked)[number] | undefined) =>
      row ? { id: row.id, amount: row.entries.reduce((sum, entry) => sum.plus(entry.amount), new Prisma.Decimal(0)).toFixed(2) } : null;
    return {
      ...withFlag,
      correctedFrom: summary(linked.find((row) => row.id === transaction.correctedFromId)),
      correctedBy: summary(linked.find((row) => row.correctedFromId === transaction.id)),
    };
  }

  // `voidable` on every transaction the API returns: whether voidTransaction()
  // would accept it -- still POSTED, not itself a reversal, and not a
  // posting a savings goal, an asset, a referral payout or zakat given
  // keeps its own record of. The UI shows Void only where this is true.
  private async withVoidable<T extends { id: string; status: string; reversalOfId: string | null; entries: { account: { accountSubtype: string | null } }[] }>(
    transactions: T[],
  ): Promise<(T & { voidable: boolean })[]> {
    const ids = transactions.map((t) => t.id);
    const [savingsEntries, assets, zakat] =
      ids.length === 0
        ? [[], [], []]
        : await Promise.all([
            this.prisma.savingsGoalEntry.findMany({ where: { transactionId: { in: ids } }, select: { transactionId: true } }),
            this.prisma.asset.findMany({
              where: { OR: [{ purchaseTransactionId: { in: ids } }, { soldTransactionId: { in: ids } }] },
              select: { purchaseTransactionId: true, soldTransactionId: true },
            }),
            this.prisma.zakatPayment.findMany({ where: { transactionId: { in: ids } }, select: { transactionId: true } }),
          ]);
    const owned = new Set<string | null>([
      ...savingsEntries.map((e) => e.transactionId),
      ...assets.flatMap((a) => [a.purchaseTransactionId, a.soldTransactionId]),
      ...zakat.map((z) => z.transactionId),
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
    const where = this.listWhere(businessId, filters);

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
          entries: { include: { account: { select: ENTRY_ACCOUNT_SELECT } } },
          contact: { select: { id: true, name: true } },
        },
        orderBy: [{ transactionDate: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.transaction.count({ where }),
    ]);

    const ids = data.map((transaction) => transaction.id);
    const [rows, charges, loanBalances, receivedBalances] = await Promise.all([
      this.withVoidable(data),
      this.chargesFor(ids),
      filters.withLoanBalance ? this.loanBalancesAfter(businessId, data) : Promise.resolve(new Map<string, string>()),
      filters.withBalanceAfter ? this.walletBalancesAfter(data, filters.accountId) : Promise.resolve(new Map<string, string>()),
    ]);
    // A transfer's two wallets just after it, the sending one after its
    // charge too (the charge is posted right after the transfer).
    const transfers = filters.withBalanceAfter ? data.filter((row) => row.transactionType === 'TRANSFER') : [];
    const chargedAt = new Map<string, Moment>();
    for (const [id, charge] of charges) if (charge.moment) chargedAt.set(id, charge.moment);
    const [fromBalances, toBalances] = transfers.length
      ? await Promise.all([this.walletBalancesAfter(transfers, undefined, 'from', chargedAt), this.walletBalancesAfter(transfers, undefined, 'to')])
      : [new Map<string, string>(), new Map<string, string>()];
    const withExtras = rows.map((row) => ({
      ...row,
      // The charge paid with this entry, if any (voided with it), and the
      // expense category it is filed under (an Edit keeps it).
      charge: charges.get(row.id)?.amount ?? null,
      chargeCategory: charges.get(row.id)?.category ?? null,
      ...(filters.withLoanBalance && { loanBalanceAfter: loanBalances.get(row.id) ?? null }),
      ...(filters.withBalanceAfter && { balanceAfter: receivedBalances.get(row.id) ?? null }),
      ...(filters.withBalanceAfter &&
        row.transactionType === 'TRANSFER' && { fromBalanceAfter: fromBalances.get(row.id) ?? null, toBalanceAfter: toBalances.get(row.id) ?? null }),
    }));
    return { data: withExtras, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  // A wallet's balance just after each row, as its ledger runs it: the
  // opening balance plus every entry on it up to and including the row, by
  // date and then by when it was made, voided originals and reversals
  // included (they cancel out from the reversal's date on). The wallet is
  // the one the list is filtered to when the row touches it, so a filtered
  // history reads one running balance; otherwise the one money came into
  // (the row's DEBIT side). pick "from" or "to" asks for the CREDIT or DEBIT
  // side instead, and at reads a row's balance at a later moment (a
  // transfer's sender after the charge posted right after it). Only entries
  // up to the newest row are read, in one walk per wallet.
  private async walletBalancesAfter(
    rows: (Moment & { id: string; entries: { accountId: string; entryType: EntryType; account: { accountType: AccountType } }[] })[],
    accountId?: string,
    pick: 'auto' | 'from' | 'to' = 'auto',
    at?: Map<string, Moment>,
  ): Promise<Map<string, string>> {
    const target = new Map<string, { accountId: string; accountType: AccountType }>();
    for (const row of rows) {
      const side =
        pick === 'from'
          ? row.entries.find((entry) => entry.entryType === EntryType.CREDIT)
          : pick === 'to'
            ? row.entries.find((entry) => entry.entryType === EntryType.DEBIT)
            : (row.entries.find((entry) => entry.accountId === accountId) ?? row.entries.find((entry) => entry.entryType === EntryType.DEBIT));
      if (side) target.set(row.id, { accountId: side.accountId, accountType: side.account.accountType });
    }
    const accountIds = [...new Set([...target.values()].map((value) => value.accountId))];
    if (accountIds.length === 0) return new Map();
    const momentOf = (row: Moment & { id: string }): Moment => {
      const later = at?.get(row.id);
      return later && !atOrBefore(later, row) ? later : row;
    };
    const newest = rows.reduce((latest, row) => (momentOf(row).transactionDate > latest ? momentOf(row).transactionDate : latest), momentOf(rows[0]).transactionDate);
    const [accounts, entries] = await Promise.all([
      this.prisma.account.findMany({ where: { id: { in: accountIds } }, select: { id: true, openingBalance: true } }),
      this.prisma.transactionEntry.findMany({
        where: { accountId: { in: accountIds }, transaction: { transactionDate: { lte: newest } } },
        select: { accountId: true, entryType: true, amount: true, transaction: { select: { transactionDate: true, createdAt: true } } },
      }),
    ]);
    const opening = new Map(accounts.map((account) => [account.id, new Prisma.Decimal(account.openingBalance)]));
    const byMoment = (a: Moment, b: Moment) => a.transactionDate.getTime() - b.transactionDate.getTime() || a.createdAt.getTime() - b.createdAt.getTime();

    const balances = new Map<string, string>();
    for (const id of accountIds) {
      const accountType = [...target.values()].find((value) => value.accountId === id)!.accountType;
      const debitPositive = isDebitPositive(accountType);
      const own = entries.filter((entry) => entry.accountId === id).sort((a, b) => byMoment(a.transaction, b.transaction));
      const wanted = rows.filter((row) => target.get(row.id)?.accountId === id).sort((a, b) => byMoment(momentOf(a), momentOf(b)));
      let balance = opening.get(id) ?? new Prisma.Decimal(0);
      let next = 0;
      for (const row of wanted) {
        while (next < own.length && atOrBefore(own[next].transaction, momentOf(row))) {
          const entry = own[next++];
          balance = (entry.entryType === EntryType.DEBIT) === debitPositive ? balance.plus(entry.amount) : balance.minus(entry.amount);
        }
        balances.set(row.id, balance.toFixed(2));
      }
    }
    return balances;
  }

  // Each entry's charge: what the expenses tied to it add up to, and the
  // expense category they are filed under.
  // Each row's charge: its amount, the category it is filed under, and when
  // the last of it was posted (null on a fake that leaves the dates out).
  private async chargesFor(ids: string[]): Promise<Map<string, { amount: string; category: string | null; moment: Moment | null }>> {
    if (ids.length === 0) return new Map();
    const charges = await this.prisma.transaction.findMany({
      where: { chargeForId: { in: ids }, reversalOfId: null },
      select: { chargeForId: true, transactionDate: true, createdAt: true, entries: { where: { entryType: EntryType.DEBIT }, select: { amount: true, categoryId: true } } },
    });
    const sums = new Map<string, { sum: Prisma.Decimal; category: string | null; moment: Moment | null }>();
    for (const charge of charges) {
      if (!charge.chargeForId) continue;
      const amount = charge.entries.reduce((sum, entry) => sum.plus(entry.amount), new Prisma.Decimal(0));
      const was = sums.get(charge.chargeForId);
      const moment: Moment | null = charge.transactionDate && charge.createdAt ? { transactionDate: charge.transactionDate, createdAt: charge.createdAt } : null;
      const latest = was?.moment && moment ? (atOrBefore(moment, was.moment) ? was.moment : moment) : (moment ?? was?.moment ?? null);
      sums.set(charge.chargeForId, { sum: (was?.sum ?? new Prisma.Decimal(0)).plus(amount), category: was?.category ?? charge.entries[0]?.categoryId ?? null, moment: latest });
    }
    return new Map([...sums].map(([id, { sum, category, moment }]) => [id, { amount: sum.toFixed(2), category, moment }]));
  }

  // A loan contact's balance just after each row: the opening balance plus
  // every principal posting (on Accounts Receivable or Payable) that still
  // stands, up to and including the row, by date and then by when it was
  // made. Every DEBIT adds and every CREDIT subtracts, the rule of the loan
  // statement (ReceivablesPayablesService.getLoanStatement): positive is
  // Pawna (they owe you), negative Dena. A profit row, voided entry or
  // reversal moves nothing, so it reads the balance as it stood.
  private async loanBalancesAfter(
    businessId: string,
    rows: { id: string; contactId: string | null; transactionDate: Date; createdAt: Date }[],
  ): Promise<Map<string, string>> {
    const contactIds = [...new Set(rows.map((row) => row.contactId).filter((id): id is string => !!id))];
    if (contactIds.length === 0) return new Map();
    const [contacts, entries] = await Promise.all([
      this.prisma.contact.findMany({ where: { businessId, id: { in: contactIds } }, select: { id: true, openingBalance: true } }),
      this.prisma.transactionEntry.findMany({
        where: {
          account: {
            businessId,
            OR: [
              { accountSubtype: 'receivable', accountType: 'ASSET' },
              { accountSubtype: 'payable', accountType: 'LIABILITY' },
            ],
          },
          transaction: { businessId, contactId: { in: contactIds }, ...STANDING_TRANSACTION },
        },
        select: { entryType: true, amount: true, transaction: { select: { contactId: true, transactionDate: true, createdAt: true } } },
      }),
    ]);
    const opening = new Map(contacts.map((contact) => [contact.id, new Prisma.Decimal(contact.openingBalance)]));

    const balances = new Map<string, string>();
    for (const row of rows) {
      if (!row.contactId || !opening.has(row.contactId)) continue;
      let balance = opening.get(row.contactId) as Prisma.Decimal;
      for (const entry of entries) {
        if (entry.transaction.contactId !== row.contactId || !atOrBefore(entry.transaction, row)) continue;
        balance = entry.entryType === 'DEBIT' ? balance.plus(entry.amount) : balance.minus(entry.amount);
      }
      balances.set(row.id, balance.toFixed(2));
    }
    return balances;
  }

  // The figures above the Transactions list, over every page the list's
  // filters match rather than the page on screen. `count` is what the list
  // calls `meta.total`; `voided` is how many of those are voided originals;
  // `standing` is how many still stand (neither voided nor a reversal);
  // `totals` sums each standing transaction's debit side (its amount), so a
  // voided entry and its reversal both drop out, as in every other total.
  // For transfers, `charges` adds up the charges paid with the standing ones
  // (each its own expense, tied to its transfer).
  async summarizeTransactions(businessId: string, filters: ListTransactionsQueryDto) {
    const where = this.listWhere(businessId, filters);
    // AND rather than a spread, so a status or type the visitor filtered on
    // narrows these figures instead of being overwritten by them.
    const totalOf = (transactionType: TransactionType) =>
      this.prisma.transactionEntry.aggregate({
        where: { entryType: EntryType.DEBIT, transaction: { AND: [where, STANDING_TRANSACTION, { transactionType }] } },
        _sum: { amount: true },
      });

    const [count, voided, standing, income, expense, transfer] = await Promise.all([
      this.prisma.transaction.count({ where }),
      this.prisma.transaction.count({ where: { AND: [where, { status: 'VOIDED', reversalOfId: null }] } }),
      this.prisma.transaction.count({ where: { AND: [where, STANDING_TRANSACTION] } }),
      totalOf('INCOME'),
      totalOf('EXPENSE'),
      totalOf('TRANSFER'),
    ]);

    const money = (sum: { _sum: { amount: Prisma.Decimal | null } }) => new Prisma.Decimal(sum._sum.amount ?? 0).toFixed(2);
    const charges = filters.transactionType === 'TRANSFER' ? await this.chargesOfStanding(where) : null;
    return {
      count,
      voided,
      standing,
      totals: { INCOME: money(income), EXPENSE: money(expense), TRANSFER: money(transfer) },
      ...(charges !== null && { charges }),
    };
  }

  // What the standing transactions `where` matches paid in charges.
  private async chargesOfStanding(where: Prisma.TransactionWhereInput): Promise<string> {
    const charged = await this.prisma.transaction.findMany({ where: { AND: [where, STANDING_TRANSACTION] }, select: { id: true } });
    if (charged.length === 0) return '0.00';
    const sum = await this.prisma.transactionEntry.aggregate({
      where: { entryType: EntryType.DEBIT, transaction: { ...STANDING_TRANSACTION, chargeForId: { in: charged.map((row) => row.id) } } },
      _sum: { amount: true },
    });
    return new Prisma.Decimal(sum._sum.amount ?? 0).toFixed(2);
  }

  // One filter for the list and its summary, so the figures always describe
  // exactly the rows the list pages through.
  private listWhere(businessId: string, filters: ListTransactionsQueryDto): Prisma.TransactionWhereInput {
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
    if (filters.excludeSavings) where.NOT = { entries: { some: { account: { accountSubtype: 'savings' } } } };
    // A loan entry's charge shows on the entry's row, not as a row of its own.
    if (filters.excludeCharges) where.chargeForId = null;
    if (filters.search) {
      // Quick entries keep what the customer typed on the entry (its note
      // and category), not on the transaction's description.
      const contains = { contains: filters.search, mode: 'insensitive' } as const;
      // An account's name finds what moved through it, and a figure (with or
      // without its grouping commas) finds that amount.
      const figure = filters.search.replace(/,/g, '').trim();
      where.OR = [
        { description: contains },
        { referenceNo: contains },
        { entries: { some: { note: contains } } },
        { entries: { some: { categoryId: contains } } },
        { entries: { some: { account: { name: contains } } } },
        ...(/^\d{1,12}(\.\d{1,2})?$/.test(figure) ? [{ entries: { some: { amount: new Prisma.Decimal(figure) } } }] : []),
      ];
    }
    return where;
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
