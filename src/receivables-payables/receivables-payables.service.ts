import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Account, AccountType, Contact, ContactCategory, Prisma } from '@prisma/client';
import { MONEY_ACCOUNT_SUBTYPES } from '../accounts/accounts.service.js';
import { dhakaDateKey, dhakaDateOnly, dhakaYear } from '../common/dhaka.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CORRECTED_REASON, TransactionsService } from '../transactions/transactions.service.js';
import { contactStatement, STATEMENT_TRANSACTION_TYPES, type ContactStatement } from './contact-statement.js';
import { ContactStatementQueryDto } from './dto/contact-statement-query.dto.js';
import { CreatePayableDto } from './dto/create-payable.dto.js';
import { CreateReceivableDto } from './dto/create-receivable.dto.js';
import { PayPaymentDto } from './dto/pay-payment.dto.js';
import { ReceivePaymentDto } from './dto/receive-payment.dto.js';
import { loanActivity, type LoanActivityPosting, type LoanEntryKind, type LoanMonth } from './loan-activity.js';
import { profitTotals } from './loan-profit.js';
import { directionBreakdown, type Direction, type DirectionBreakdown, type DirectionPosting } from './direction-breakdown.js';
import { loanStatementRows, type LoanStatementItem, type LoanStatementRow } from './loan-statement.js';

export type { Direction, DirectionBreakdown, InvoiceBreakdown } from './direction-breakdown.js';
export type { LoanStatementRow } from './loan-statement.js';

export interface AgingBucketRow {
  contactId: string;
  contactName: string;
  current: string;
  days1to30: string;
  days31to60: string;
  over60: string;
  total: string;
  // Carried straight from this contact's DirectionBreakdown -- lets the
  // frontend show a "paid so far" progress indicator without a second
  // per-contact call.
  totalInvoiced: string;
  totalPaid: string;
  // What of their opening balance -- owed from before Books, on no invoice --
  // is still unpaid on this side, once general payments have settled it
  // first (DirectionBreakdown.openingRemaining). It has no due date, so it is
  // in no bucket and not in `total`.
  openingRemaining: string;
}

export interface AgingReport {
  buckets: { current: string; days1to30: string; days31to60: string; over60: string };
  // Every looked-at contact's openingRemaining, including the ones with no
  // row because nothing on an invoice is outstanding.
  openingRemaining: string;
  contacts: AgingBucketRow[];
}

export interface OverdueRow {
  contactId: string;
  contactName: string;
  transactionId: string;
  description: string | null;
  originalAmount: string;
  remainingAmount: string;
  dueDate: Date;
  daysOverdue: number;
}

export interface DueSoonRow {
  contactId: string;
  contactName: string;
  transactionId: string;
  description: string | null;
  remainingAmount: string;
  dueDate: Date;
  // 0 for something due today.
  daysUntilDue: number;
}

// A due-soon row for the bell's loan reminders: either way, any contact.
export interface DueReminderRow extends DueSoonRow {
  contactCategory: Contact['category'];
  direction: Direction;
}

export type LoanBalanceDirection = 'DENA' | 'PAWNA' | 'SETTLED';

export interface LoanDashboardRow {
  contactId: string;
  contactName: string;
  contactPhone: string | null;
  openingBalance: string;
  // "Receive" = cash that came IN for this loan relationship (a loan we
  // borrowed, plus any repayments received back from money we lent out).
  // "Payment" = cash that went OUT (a loan we gave out, plus any
  // repayments we made on money we borrowed). Same framing as the
  // reference layout's RECEIVE/PAYMENT columns.
  totalReceive: string;
  totalPayment: string;
  // Profit or interest paid to them and received from them, all time. It
  // never moves currentBalance.
  profitPaid: string;
  profitReceived: string;
  currentBalance: string;
  direction: LoanBalanceDirection;
  // How many entries there are with them, and the newest one's kind and
  // day (Contacts' "Last activity").
  entries: number;
  lastEntry: { kind: LoanEntryKind; date: string } | null;
  // The day of their first entry (the statement's "Since").
  firstEntryDate: string | null;
}

export interface LoanDashboard {
  totalDena: string;
  totalPawna: string;
  totalPaid: string;
  totalReceived: string;
  netBalance: string;
  activeAccounts: number;
  // Profit paid in this Asia/Dhaka year, and who most of it went to with
  // about how much a month.
  profitPaidThisYear: string;
  topProfit: { contactId: string; contactName: string; monthly: string } | null;
  // This Asia/Dhaka month's loan money, by what it was for.
  thisMonth: LoanMonth;
  rows: LoanDashboardRow[];
}

export interface LoanStatement {
  contactId: string;
  contactName: string;
  openingBalance: string;
  balanceBroughtForward: string;
  rows: LoanStatementRow[];
  closingBalance: string;
}

type AgingBucket = 'current' | 'days1to30' | 'days31to60' | 'over60';

// Today's Dhaka calendar date, at UTC midnight like the stored due dates --
// a due date of today stays current until Dhaka midnight, not 6am.
function todayUtcMidnight(): Date {
  return dhakaDateOnly(new Date());
}

const DAY_MS = 24 * 60 * 60 * 1000;

// A statement's dateFrom..dateTo as a transactionDate filter, both days
// included; undefined when neither is set.
function transactionDateWindow(filters: { dateFrom?: string; dateTo?: string }): Prisma.DateTimeFilter | undefined {
  if (!filters.dateFrom && !filters.dateTo) return undefined;
  return { ...(filters.dateFrom && { gte: new Date(filters.dateFrom) }), ...(filters.dateTo && { lte: new Date(filters.dateTo) }) };
}

// What a contact statement reads of each posting (see contact-statement.ts).
const STATEMENT_POSTING_SELECT = {
  id: true,
  transactionType: true,
  transactionDate: true,
  createdAt: true,
  referenceNo: true,
  description: true,
  status: true,
  reversalOfId: true,
  entries: { select: { entryType: true, amount: true, account: { select: { name: true, accountSubtype: true } } } },
} satisfies Prisma.TransactionSelect;

// The whole point of this module (per the product blueprint): Receivable/
// Payable are NOT a parallel data structure -- they're the "Accounts
// Receivable"/"Accounts Payable" system accounts from Prompt 4's Chart of
// Accounts, viewed through a contact-centric lens, using the exact same
// Transaction Engine from Prompt 5 (SALE/PURCHASE/PAYMENT are transaction
// types that already existed in that schema). Every write here is just
// "which two accounts, which direction" handed to
// TransactionsService.createTransaction() -- same wrapper pattern as
// Prompt 6's QuickEntriesService.
type PostedEntry = Awaited<ReturnType<TransactionsService['createTransaction']>>;

@Injectable()
export class ReceivablesPayablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactionsService: TransactionsService,
  ) {}

  // For a BUSINESS contact this is a credit sale -- revenue recognized
  // immediately, cash arrives later (Dr Accounts Receivable / Cr Income).
  // For a LOAN contact this is giving out a loan -- real cash leaves a
  // money account right now, and none of it is revenue (Dr Accounts
  // Receivable / Cr the money account). Same transactionType (SALE) and
  // same AR account either way -- computeDirection() only ever looks at
  // the entry against the AR account, so nothing downstream (aging,
  // the Loan Dashboard, the Trial Balance) needs to know which flavor
  // this was.
  async recordSale(businessId: string, dto: CreateReceivableDto, userId: string, tx?: Prisma.TransactionClient): Promise<PostedEntry> {
    if (!tx) return this.prisma.$transaction((client) => this.recordSale(businessId, dto, userId, client));
    const contact = await this.requireContact(businessId, dto.contactId);
    // The Customer/Supplier rule is for trade contacts only: a loan can be
    // given to (or taken from) any kind of loan contact, a Bank, an NGO or
    // a Relative included.
    if (contact.category !== 'LOAN' && contact.type !== 'CUSTOMER' && contact.type !== 'BOTH') {
      throw new BadRequestException('This contact must be a Customer (or Customer & Supplier) to record a credit sale');
    }
    const arAccount = await this.requireSystemAccount(businessId, 'receivable', 'ASSET', 'Accounts Receivable');
    const moneyAccountId = contact.category === 'LOAN' ? (await this.requireMoneyAccountForLoan(businessId, dto.moneyAccountId)).id : null;

    const otherEntry = moneyAccountId
      ? { accountId: moneyAccountId, entryType: 'CREDIT' as const }
      : {
          accountId: (
            await this.requireAccountOfType(businessId, dto.incomeAccountId ?? (await this.getDefaultIncomeAccountId(businessId)), 'INCOME', 'incomeAccountId')
          ).id,
          entryType: 'CREDIT' as const,
        };

    const posted = await this.transactionsService.createTransaction(
      businessId,
      {
        transactionType: 'SALE',
        transactionDate: dto.date,
        dueDate: dto.dueDate,
        description: dto.description,
        referenceNo: dto.referenceNo,
        contactId: contact.id,
        entries: [
          { accountId: arAccount.id, entryType: 'DEBIT', amount: dto.amount },
          { accountId: otherEntry.accountId, entryType: otherEntry.entryType, amount: dto.amount },
        ],
      },
      userId,
      tx,
    );
    return this.withCharge(tx, businessId, posted, dto, moneyAccountId, userId);
  }

  // Mirror of recordSale() above -- for BUSINESS this is a credit purchase
  // (expense recognized, Dr Expense / Cr Accounts Payable); for LOAN this
  // is taking out a loan (real cash lands in a money account right now,
  // none of it an expense: Dr the money account / Cr Accounts Payable).
  async recordPurchase(businessId: string, dto: CreatePayableDto, userId: string, tx?: Prisma.TransactionClient): Promise<PostedEntry> {
    if (!tx) return this.prisma.$transaction((client) => this.recordPurchase(businessId, dto, userId, client));
    const contact = await this.requireContact(businessId, dto.contactId);
    // Trade contacts only, as in recordSale().
    if (contact.category !== 'LOAN' && contact.type !== 'SUPPLIER' && contact.type !== 'BOTH') {
      throw new BadRequestException('This contact must be a Supplier (or Customer & Supplier) to record a credit purchase');
    }
    const apAccount = await this.requireSystemAccount(businessId, 'payable', 'LIABILITY', 'Accounts Payable');

    const moneyAccountId = contact.category === 'LOAN' ? (await this.requireMoneyAccountForLoan(businessId, dto.moneyAccountId)).id : null;
    const debitAccountId =
      moneyAccountId ??
      (await this.requireAccountOfType(businessId, dto.expenseAccountId ?? (await this.getDefaultExpenseAccountId(businessId)), 'EXPENSE', 'expenseAccountId'))
        .id;

    const posted = await this.transactionsService.createTransaction(
      businessId,
      {
        transactionType: 'PURCHASE',
        transactionDate: dto.date,
        dueDate: dto.dueDate,
        description: dto.description,
        referenceNo: dto.referenceNo,
        contactId: contact.id,
        entries: [
          { accountId: debitAccountId, entryType: 'DEBIT', amount: dto.amount },
          { accountId: apAccount.id, entryType: 'CREDIT', amount: dto.amount },
        ],
      },
      userId,
      tx,
    );
    return this.withCharge(tx, businessId, posted, dto, moneyAccountId, userId);
  }

  async receivePayment(businessId: string, dto: ReceivePaymentDto, userId: string, tx?: Prisma.TransactionClient): Promise<PostedEntry> {
    const contact = await this.requireContact(businessId, dto.contactId);
    const arAccount = await this.requireSystemAccount(businessId, 'receivable', 'ASSET', 'Accounts Receivable');
    const moneyAccount = await this.requireMoneyAccount(businessId, dto.moneyAccountId);

    // Checked and posted under the contact's lock: two payments sent at
    // once can't both fit under the same outstanding balance. A caller with
    // its own transaction (an Edit) holds that lock already.
    const post = async (client: Prisma.TransactionClient) => {
      await this.validatePaymentAmount(businessId, contact, 'RECEIVABLE', dto.amount, dto.appliedToTransactionId, client);

      const posted = await this.transactionsService.createTransaction(
        businessId,
        {
          transactionType: 'PAYMENT',
          transactionDate: dto.date,
          description: dto.description,
          referenceNo: dto.referenceNo,
          contactId: contact.id,
          appliedToTransactionId: dto.appliedToTransactionId,
          entries: [
            { accountId: moneyAccount.id, entryType: 'DEBIT', amount: dto.amount },
            { accountId: arAccount.id, entryType: 'CREDIT', amount: dto.amount },
          ],
        },
        userId,
        client,
      );
      return this.withCharge(client, businessId, posted, dto, moneyAccount.id, userId);
    };
    return tx ? post(tx) : this.transactionsService.withLocks([`contact:${contact.id}`], post);
  }

  async payPayment(businessId: string, dto: PayPaymentDto, userId: string, tx?: Prisma.TransactionClient): Promise<PostedEntry> {
    const contact = await this.requireContact(businessId, dto.contactId);
    const apAccount = await this.requireSystemAccount(businessId, 'payable', 'LIABILITY', 'Accounts Payable');
    const moneyAccount = await this.requireMoneyAccount(businessId, dto.moneyAccountId);

    // Checked and posted under the contact's lock: two payments sent at
    // once can't both fit under the same outstanding balance. A caller with
    // its own transaction (an Edit) holds that lock already.
    const post = async (client: Prisma.TransactionClient) => {
      await this.validatePaymentAmount(businessId, contact, 'PAYABLE', dto.amount, dto.appliedToTransactionId, client);

      const posted = await this.transactionsService.createTransaction(
        businessId,
        {
          transactionType: 'PAYMENT',
          transactionDate: dto.date,
          description: dto.description,
          referenceNo: dto.referenceNo,
          contactId: contact.id,
          appliedToTransactionId: dto.appliedToTransactionId,
          entries: [
            { accountId: apAccount.id, entryType: 'DEBIT', amount: dto.amount },
            { accountId: moneyAccount.id, entryType: 'CREDIT', amount: dto.amount },
          ],
        },
        userId,
        client,
      );
      return this.withCharge(client, businessId, posted, dto, moneyAccount.id, userId);
    };
    return tx ? post(tx) : this.transactionsService.withLocks([`contact:${contact.id}`], post);
  }

  // Editing a loan or trade entry: the original is voided 'Corrected' (its
  // charge with it) and the corrected one posted in the same database
  // transaction under the contacts' locks, as Income & Expense's Edit does
  // (QuickEntriesService.correct). An entry stays the kind it was.
  correctSale(businessId: string, transactionId: string, dto: CreateReceivableDto, userId: string) {
    return this.correct(businessId, transactionId, 'SALE', dto.contactId, userId, (tx) => this.recordSale(businessId, dto, userId, tx));
  }

  correctPurchase(businessId: string, transactionId: string, dto: CreatePayableDto, userId: string) {
    return this.correct(businessId, transactionId, 'PURCHASE', dto.contactId, userId, (tx) => this.recordPurchase(businessId, dto, userId, tx));
  }

  correctReceivedPayment(businessId: string, transactionId: string, dto: ReceivePaymentDto, userId: string) {
    return this.correct(businessId, transactionId, 'RECEIVED', dto.contactId, userId, (tx) => this.receivePayment(businessId, dto, userId, tx));
  }

  correctPaidPayment(businessId: string, transactionId: string, dto: PayPaymentDto, userId: string) {
    return this.correct(businessId, transactionId, 'PAID', dto.contactId, userId, (tx) => this.payPayment(businessId, dto, userId, tx));
  }

  private async correct(
    businessId: string,
    transactionId: string,
    kind: 'SALE' | 'PURCHASE' | 'RECEIVED' | 'PAID',
    contactId: string,
    userId: string,
    post: (tx: Prisma.TransactionClient) => Promise<PostedEntry>,
  ) {
    const original = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      select: { businessId: true, transactionType: true, contactId: true, entries: { select: { account: { select: { accountSubtype: true } } } } },
    });
    if (!original || original.businessId !== businessId) {
      throw new NotFoundException('Transaction not found');
    }
    // A payment is money received when it settles Accounts Receivable.
    const actual =
      original.transactionType === 'PAYMENT'
        ? original.entries.some((entry) => entry.account.accountSubtype === 'receivable')
          ? 'RECEIVED'
          : 'PAID'
        : original.transactionType;
    if (actual !== kind) {
      throw new BadRequestException("This entry is of another kind, so it can't be corrected as this one");
    }
    const keys = [...new Set([original.contactId, contactId].filter((id): id is string => !!id))].map((id) => `contact:${id}`);
    return this.transactionsService.withLocks(keys, async (tx) => {
      await this.transactionsService.voidTransaction(businessId, transactionId, CORRECTED_REASON, userId, tx);
      const corrected = await post(tx);
      // So History can say what it corrected (and the original, what replaced it).
      await tx.transaction.update({ where: { id: corrected.id }, data: { correctedFromId: transactionId } });
      return { ...corrected, correctedFromId: transactionId };
    });
  }

  // The entry's charge, when one was sent: only a loan entry has a wallet
  // to pay it from (a trade sale or purchase moves no money).
  private async withCharge(
    tx: Prisma.TransactionClient,
    businessId: string,
    posted: PostedEntry,
    dto: { charge?: number; date: string; contactId: string },
    moneyAccountId: string | null,
    userId: string,
  ): Promise<PostedEntry> {
    if (!dto.charge) return posted;
    if (!moneyAccountId) {
      throw new BadRequestException('A charge can only be paid with a loan entry, out of its wallet');
    }
    await this.transactionsService.postCharge(
      tx,
      businessId,
      posted.id,
      { amount: dto.charge, moneyAccountId, date: dto.date, contactId: dto.contactId },
      userId,
    );
    return posted;
  }

  async getContactBalanceDetail(businessId: string, contactId: string) {
    const contact = await this.requireContact(businessId, contactId);
    // Sequential, not Promise.all -- this local dev Postgres (prisma dev's
    // built-in server, see prisma.config.ts) has shown it can drop
    // connections under even modest concurrent query load; two direction
    // computations for one contact detail page isn't worth that risk.
    const receivable = await this.computeDirection(businessId, contact, 'RECEIVABLE');
    const payable = await this.computeDirection(businessId, contact, 'PAYABLE');
    const currentBalance = new Prisma.Decimal(contact.openingBalance).plus(receivable.balance).minus(payable.balance);

    return {
      contactId,
      openingBalance: contact.openingBalance.toFixed(2),
      currentBalance: currentBalance.toFixed(2),
      receivable,
      payable,
    };
  }

  // Used by ContactsService (list/getOne) for Contact.currentBalance --
  // same underlying calc as getContactBalanceDetail(), without formatting
  // the full per-transaction breakdown those callers don't need. Note this
  // is O(contacts on the page), same "acceptable at this app's realistic
  // scale" tradeoff documented for Prompt 7's ledger pagination. Sequential
  // for the same connection-pool-safety reason as getContactBalanceDetail().
  async getContactCurrentBalance(businessId: string, contact: Contact): Promise<Prisma.Decimal> {
    const receivable = await this.computeDirection(businessId, contact, 'RECEIVABLE');
    const payable = await this.computeDirection(businessId, contact, 'PAYABLE');
    return new Prisma.Decimal(contact.openingBalance).plus(receivable.balance).minus(payable.balance);
  }

  // The Loan Management "Ledger" -- one contact, one date range, running
  // balance carried forward, same shape as Prompt 7's Account Ledger
  // (getLedger()) but scoped by contactId across BOTH the Accounts
  // Receivable AND Accounts Payable system accounts instead of a single
  // accountId. Both feed ONE unified "Running Principal": a loan contact's
  // balance can flip between being a receivable (they owe us) and a
  // payable (we owe them) over time (e.g. they borrow, repay in full,
  // later we borrow from them), and this statement shows a single running
  // balance either way, not two separate ledgers.
  //
  // IMPORTANT: the delta rule here is DEBIT=+amount / CREDIT=-amount for
  // EVERY entry, on BOTH the AR and AP account -- NOT Prompt 7's
  // isDebitPositive(accountType) rule (which would treat AP, a LIABILITY,
  // the opposite way). This has to match getContactCurrentBalance()'s
  // definition: currentBalance = opening + receivable.remaining -
  // payable.remaining, i.e. the AP side is SUBTRACTED. Expanding that (AR's
  // remaining = debits-credits, AP's remaining = credits-debits) collapses
  // to a single uniform rule: every DEBIT (on either account) adds, every
  // CREDIT subtracts. Concretely: giving a loan (AR debit) and repaying a
  // loan we took (AP debit) both correctly move the balance toward Pawna;
  // receiving a repayment (AR credit) and taking a loan (AP credit) both
  // correctly move it toward Dena. A prior version of this method used
  // isDebitPositive() and got taking-a-loan/repaying-a-loan backwards --
  // caught by testing a mixed receivable+payable history on one contact.
  async getLoanStatement(businessId: string, contactId: string, filters: { dateFrom?: string; dateTo?: string } = {}): Promise<LoanStatement> {
    const contact = await this.requireContact(businessId, contactId);

    const arAccount = await this.findSystemAccount(this.prisma, businessId, 'receivable', 'ASSET');
    const apAccount = await this.findSystemAccount(this.prisma, businessId, 'payable', 'LIABILITY');
    const accountIds = [arAccount?.id, apAccount?.id].filter((id): id is string => !!id);

    let balanceBroughtForward = new Prisma.Decimal(contact.openingBalance);
    if (filters.dateFrom && accountIds.length > 0) {
      const priorEntries = await this.prisma.transactionEntry.findMany({
        where: {
          accountId: { in: accountIds },
          transaction: { contactId, status: 'POSTED', reversalOfId: null, transactionDate: { lt: new Date(filters.dateFrom) } },
        },
      });
      for (const entry of priorEntries) {
        const amount = new Prisma.Decimal(entry.amount);
        const delta = entry.entryType === 'DEBIT' ? amount : amount.negated();
        balanceBroughtForward = balanceBroughtForward.plus(delta);
      }
    }

    const dateFilter = transactionDateWindow(filters);

    const entries =
      accountIds.length === 0
        ? []
        : await this.prisma.transactionEntry.findMany({
            where: {
              accountId: { in: accountIds },
              transaction: { contactId, ...(dateFilter && { transactionDate: dateFilter }) },
            },
            include: { transaction: true },
            orderBy: [{ transaction: { transactionDate: 'asc' } }, { transaction: { createdAt: 'asc' } }],
          });

    // Profit or interest paid to or received from them: an expense or an
    // income with this contact (never a reversal, which only undoes one).
    const profits = await this.prisma.transaction.findMany({
      where: {
        businessId,
        contactId,
        transactionType: { in: ['INCOME', 'EXPENSE'] },
        reversalOfId: null,
        chargeForId: null,
        ...(dateFilter && { transactionDate: dateFilter }),
      },
      include: { entries: { where: { entryType: 'DEBIT' }, select: { amount: true } } },
    });

    // Principal and profit in date order; only principal that still stands
    // moves the balance (loan-statement.ts).
    const items: LoanStatementItem[] = [
      ...entries.map((entry) => ({ transaction: entry.transaction, principal: entry })),
      ...profits.map((transaction) => ({
        transaction,
        principal: null,
        profit: transaction.entries.reduce((sum, entry) => sum.plus(entry.amount), new Prisma.Decimal(0)),
      })),
    ];
    // Each entry's charge (a bank or service fee posted with it), to say
    // under its note.
    const charges = items.length
      ? await this.prisma.transaction.findMany({
          where: { businessId, chargeForId: { in: items.map((item) => item.transaction.id) }, status: 'POSTED', reversalOfId: null },
          select: { chargeForId: true, entries: { where: { entryType: 'DEBIT' }, select: { amount: true } } },
        })
      : [];
    const chargeOf = new Map<string, Prisma.Decimal>();
    for (const charge of charges) {
      if (!charge.chargeForId) continue;
      const amount = charge.entries.reduce((sum, entry) => sum.plus(entry.amount), new Prisma.Decimal(0));
      chargeOf.set(charge.chargeForId, (chargeOf.get(charge.chargeForId) ?? new Prisma.Decimal(0)).plus(amount));
    }
    const rows: LoanStatementRow[] = loanStatementRows(items, balanceBroughtForward).map((row) => ({ ...row, charge: chargeOf.get(row.transactionId)?.toFixed(2) ?? null }));

    return {
      contactId,
      contactName: contact.name,
      openingBalance: contact.openingBalance.toFixed(2),
      balanceBroughtForward: balanceBroughtForward.toFixed(2),
      rows,
      closingBalance: rows.length > 0 ? rows[rows.length - 1].runningPrincipal : balanceBroughtForward.toFixed(2),
    };
  }

  // Books' customer/supplier statement: every sale, purchase and payment
  // oldest first, a page at a time, with the running balance carried over
  // the contact's whole history -- page 2 opens where page 1 closed, and the
  // closing balance is the period's on every page. The rules live in
  // contact-statement.ts; this only fetches. Unlike getLoanStatement(), a
  // voided posting and its reversal never move the balance (both are shown,
  // flagged), which is how this statement has always read. A row's amount is
  // its receivable or payable line, as computeDirection() counts it, so with
  // no dates closingBalance is Contact.currentBalance. That differs from the
  // browser only on postings sent to the raw transactions API: a sale of
  // Dr Cash 600 / Dr Receivable 400 / Cr Sales 1000 reads 400, not 600 (see
  // contact-statement.ts for the other case).
  async getContactStatement(businessId: string, contactId: string, filters: ContactStatementQueryDto = {}): Promise<ContactStatement> {
    const contact = await this.requireContact(businessId, contactId);
    // Otherwise "before the period" would take in postings after it.
    if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) {
      throw new BadRequestException('dateFrom must be on or before dateTo');
    }

    const where: Prisma.TransactionWhereInput = { businessId, contactId, transactionType: { in: STATEMENT_TRANSACTION_TYPES } };
    const orderBy: Prisma.TransactionOrderByWithRelationInput[] = [{ transactionDate: 'asc' }, { createdAt: 'asc' }];
    // Before the period only to carry its balance forward. Sequential, for
    // the connection-pool reason getContactBalanceDetail() gives.
    const prior = filters.dateFrom
      ? await this.prisma.transaction.findMany({
          where: { ...where, transactionDate: { lt: new Date(filters.dateFrom) } },
          select: STATEMENT_POSTING_SELECT,
          orderBy,
        })
      : [];
    const periodDates = transactionDateWindow(filters);
    const period = await this.prisma.transaction.findMany({
      where: { ...where, ...(periodDates && { transactionDate: periodDates }) },
      select: STATEMENT_POSTING_SELECT,
      orderBy,
    });

    return {
      contactId,
      contactName: contact.name,
      ...contactStatement({ openingBalance: contact.openingBalance, prior, period, page: filters.page ?? 1, limit: filters.limit ?? 50 }),
    };
  }

  async getAging(businessId: string, direction: Direction, category?: ContactCategory): Promise<AgingReport> {
    // Which contacts: see dueContactsWhere(). Books asks for BUSINESS, Loan
    // Management for LOAN -- the same engine through two lenses.
    const contacts = await this.prisma.contact.findMany({
      where: this.dueContactsWhere(businessId, direction, category),
      orderBy: { name: 'asc' },
    });

    const buckets: Record<AgingBucket, Prisma.Decimal> = {
      current: new Prisma.Decimal(0),
      days1to30: new Prisma.Decimal(0),
      days31to60: new Prisma.Decimal(0),
      over60: new Prisma.Decimal(0),
    };
    const today = todayUtcMidnight();
    const rows: AgingBucketRow[] = [];
    let openingRemaining = new Prisma.Decimal(0);

    const breakdowns = await this.computeDirections(businessId, contacts, direction);
    for (const contact of contacts) {
      const breakdown = breakdowns.get(contact.id)!;
      // Counted before the row check: a contact who owes only from before
      // has no row, but what they owe is still in the report's total.
      openingRemaining = openingRemaining.plus(breakdown.openingRemaining);
      if (new Prisma.Decimal(breakdown.remaining).lessThanOrEqualTo(0)) continue;

      const rowBuckets: Record<AgingBucket, Prisma.Decimal> = {
        current: new Prisma.Decimal(0),
        days1to30: new Prisma.Decimal(0),
        days31to60: new Prisma.Decimal(0),
        over60: new Prisma.Decimal(0),
      };
      for (const t of breakdown.transactions) {
        const remaining = new Prisma.Decimal(t.remainingAmount);
        if (remaining.lessThanOrEqualTo(0)) continue;
        const bucket = this.bucketFor(t.dueDate, today);
        rowBuckets[bucket] = rowBuckets[bucket].plus(remaining);
        buckets[bucket] = buckets[bucket].plus(remaining);
      }

      rows.push({
        contactId: contact.id,
        contactName: contact.name,
        current: rowBuckets.current.toFixed(2),
        days1to30: rowBuckets.days1to30.toFixed(2),
        days31to60: rowBuckets.days31to60.toFixed(2),
        over60: rowBuckets.over60.toFixed(2),
        total: breakdown.remaining,
        totalInvoiced: breakdown.totalInvoiced,
        totalPaid: breakdown.totalPaid,
        openingRemaining: breakdown.openingRemaining,
      });
    }

    return {
      buckets: {
        current: buckets.current.toFixed(2),
        days1to30: buckets.days1to30.toFixed(2),
        days31to60: buckets.days31to60.toFixed(2),
        over60: buckets.over60.toFixed(2),
      },
      openingRemaining: openingRemaining.toFixed(2),
      contacts: rows,
    };
  }

  async getOverdue(businessId: string, direction: Direction, category?: ContactCategory): Promise<OverdueRow[]> {
    const contacts = await this.prisma.contact.findMany({
      where: this.dueContactsWhere(businessId, direction, category),
    });

    const today = todayUtcMidnight();
    const rows: OverdueRow[] = [];
    const breakdowns = await this.computeDirections(businessId, contacts, direction);
    for (const contact of contacts) {
      const breakdown = breakdowns.get(contact.id)!;
      for (const t of breakdown.transactions) {
        if (!t.isOverdue || !t.dueDate) continue;
        const daysOverdue = Math.floor((today.getTime() - t.dueDate.getTime()) / DAY_MS);
        rows.push({
          contactId: contact.id,
          contactName: contact.name,
          transactionId: t.transactionId,
          description: t.description,
          originalAmount: t.originalAmount,
          remainingAmount: t.remainingAmount,
          dueDate: t.dueDate,
          daysOverdue,
        });
      }
    }

    rows.sort((a, b) => b.daysOverdue - a.daysOverdue);
    return rows;
  }

  // What falls due within the next `days` days, today included, and is not
  // paid off yet: the "Due this week" list. Anything already overdue is
  // getOverdue()'s, so no row shows up in both. Which contacts: see
  // dueContactsWhere().
  async getDueSoon(businessId: string, direction: Direction, days = 7, category?: ContactCategory): Promise<DueSoonRow[]> {
    const contacts = await this.prisma.contact.findMany({
      where: this.dueContactsWhere(businessId, direction, category),
    });

    const today = todayUtcMidnight();
    const horizon = today.getTime() + days * DAY_MS;
    const rows: DueSoonRow[] = [];
    const breakdowns = await this.computeDirections(businessId, contacts, direction);
    for (const contact of contacts) {
      const breakdown = breakdowns.get(contact.id)!;
      for (const t of breakdown.transactions) {
        if (!t.dueDate || t.isOverdue || t.dueDate.getTime() > horizon) continue;
        if (new Prisma.Decimal(t.remainingAmount).lessThanOrEqualTo(0)) continue;
        rows.push({
          contactId: contact.id,
          contactName: contact.name,
          transactionId: t.transactionId,
          description: t.description,
          remainingAmount: t.remainingAmount,
          dueDate: t.dueDate,
          daysUntilDue: Math.round((t.dueDate.getTime() - today.getTime()) / DAY_MS),
        });
      }
    }

    rows.sort((a, b) => a.daysUntilDue - b.daysUntilDue || a.dueDate.getTime() - b.dueDate.getTime());
    return rows;
  }

  // What falls due in the next `days` days, today included, either way and
  // with any kind of contact (Dena-Pawna's and Loan Management's alike): the
  // bell's loan reminders. Only the contacts with such an entry are worked
  // out.
  async dueWithin(businessId: string, days: number): Promise<DueReminderRow[]> {
    const today = todayUtcMidnight();
    const horizon = today.getTime() + days * DAY_MS;
    const due = await this.prisma.transaction.findMany({
      where: {
        businessId,
        transactionType: { in: ['SALE', 'PURCHASE'] },
        status: 'POSTED',
        reversalOfId: null,
        contactId: { not: null },
        dueDate: { gte: today, lte: new Date(horizon) },
      },
      select: { contactId: true },
      distinct: ['contactId'],
    });
    if (due.length === 0) return [];
    const contacts = await this.prisma.contact.findMany({ where: { businessId, id: { in: due.map((row) => row.contactId as string) } } });

    const rows: DueReminderRow[] = [];
    const sides = {
      RECEIVABLE: await this.computeDirections(businessId, contacts, 'RECEIVABLE'),
      PAYABLE: await this.computeDirections(businessId, contacts, 'PAYABLE'),
    };
    for (const contact of contacts) {
      for (const direction of ['RECEIVABLE', 'PAYABLE'] as const) {
        const breakdown = sides[direction].get(contact.id)!;
        for (const t of breakdown.transactions) {
          if (!t.dueDate || t.isOverdue || t.dueDate.getTime() > horizon) continue;
          if (new Prisma.Decimal(t.remainingAmount).lessThanOrEqualTo(0)) continue;
          rows.push({
            contactId: contact.id,
            contactName: contact.name,
            contactCategory: contact.category,
            direction,
            transactionId: t.transactionId,
            description: t.description,
            remainingAmount: t.remainingAmount,
            dueDate: t.dueDate,
            daysUntilDue: Math.round((t.dueDate.getTime() - today.getTime()) / DAY_MS),
          });
        }
      }
    }
    return rows;
  }

  // Loan Management's dashboard -- same engine as Dena-Pawna
  // (computeDirection() against the same Accounts Receivable/Payable
  // accounts), over the workspace's loan contacts, as the loan pages list
  // them. "Record Sale on
  // Credit" = give a loan (Pawna, they owe you); "Record Purchase on
  // Credit" = take a loan (Dena, you owe them); the existing payment
  // endpoints settle either side -- no new write path needed, this is
  // purely a themed read view over the same data.
  async getLoanDashboard(businessId: string): Promise<LoanDashboard> {
    // Loan contacts only: a workspace's trade customers and suppliers
    // belong to Books, and opening one from here showed an empty statement.
    const contacts = await this.prisma.contact.findMany({
      where: { businessId, category: 'LOAN' },
      orderBy: { name: 'asc' },
    });

    // Profit or interest with a loan contact, posted and not undone.
    const profitPostings = await this.prisma.transaction.findMany({
      where: {
        businessId,
        contactId: { not: null },
        contact: { category: 'LOAN' },
        transactionType: { in: ['INCOME', 'EXPENSE'] },
        status: 'POSTED',
        reversalOfId: null,
        chargeForId: null,
      },
      select: { contactId: true, transactionDate: true, createdAt: true, transactionType: true, entries: { where: { entryType: 'DEBIT' }, select: { amount: true } } },
    });
    const activity = loanActivity(
      [
        ...(await this.loanPrincipalPostings(businessId, contacts)),
        ...profitPostings.map((posting) => ({
          contactId: posting.contactId as string,
          kind: (posting.transactionType === 'EXPENSE' ? 'PROFIT_PAID' : 'PROFIT_RECEIVED') as LoanEntryKind,
          amount: posting.entries.reduce((sum, entry) => sum + Number(entry.amount), 0),
          date: posting.transactionDate,
          createdAt: posting.createdAt,
        })),
      ],
      dhakaDateKey(new Date()).slice(0, 7),
    );
    const profit = profitTotals(
      profitPostings.map((posting) => ({
        contactId: posting.contactId as string,
        date: posting.transactionDate,
        amount: posting.entries.reduce((sum, entry) => sum + Number(entry.amount), 0),
        paid: posting.transactionType === 'EXPENSE',
      })),
      dhakaYear(new Date()),
    );

    let totalDena = new Prisma.Decimal(0);
    let totalPawna = new Prisma.Decimal(0);
    let totalPaid = new Prisma.Decimal(0);
    let totalReceived = new Prisma.Decimal(0);
    const rows: LoanDashboardRow[] = [];

    const receivables = await this.computeDirections(businessId, contacts, 'RECEIVABLE');
    const payables = await this.computeDirections(businessId, contacts, 'PAYABLE');
    for (const contact of contacts) {
      const receivable = receivables.get(contact.id)!;
      const payable = payables.get(contact.id)!;
      const opening = new Prisma.Decimal(contact.openingBalance);
      const currentBalance = opening.plus(receivable.balance).minus(payable.balance);

      // Cash paid out = loans given (receivable.totalInvoiced) + loans
      // repaid (payable.totalPaid). Cash received = loans taken
      // (payable.totalInvoiced) + repayments collected (receivable.totalPaid).
      const totalPayment = new Prisma.Decimal(receivable.totalInvoiced).plus(payable.totalPaid);
      const totalReceive = new Prisma.Decimal(payable.totalInvoiced).plus(receivable.totalPaid);

      // Nothing ever entered with them: no row. Profit alone still counts, so
      // a contact with only profit postings keeps its Profit paid figure.
      if (opening.equals(0) && totalPayment.equals(0) && totalReceive.equals(0) && !activity.byContact.get(contact.id)?.entries) continue;

      totalPaid = totalPaid.plus(totalPayment);
      totalReceived = totalReceived.plus(totalReceive);
      if (currentBalance.greaterThan(0)) totalPawna = totalPawna.plus(currentBalance);
      if (currentBalance.lessThan(0)) totalDena = totalDena.plus(currentBalance.abs());

      const direction: LoanBalanceDirection = currentBalance.greaterThan(0) ? 'PAWNA' : currentBalance.lessThan(0) ? 'DENA' : 'SETTLED';
      rows.push({
        contactId: contact.id,
        contactName: contact.name,
        contactPhone: contact.phone,
        openingBalance: opening.toFixed(2),
        totalReceive: totalReceive.toFixed(2),
        totalPayment: totalPayment.toFixed(2),
        profitPaid: (profit.byContact.get(contact.id)?.paid ?? 0).toFixed(2),
        profitReceived: (profit.byContact.get(contact.id)?.received ?? 0).toFixed(2),
        currentBalance: currentBalance.toFixed(2),
        direction,
        entries: activity.byContact.get(contact.id)?.entries ?? 0,
        lastEntry: activity.byContact.get(contact.id)?.last ?? null,
        firstEntryDate: activity.byContact.get(contact.id)?.first ?? null,
      });
    }

    return {
      totalDena: totalDena.toFixed(2),
      totalPawna: totalPawna.toFixed(2),
      totalPaid: totalPaid.toFixed(2),
      totalReceived: totalReceived.toFixed(2),
      netBalance: totalPawna.minus(totalDena).toFixed(2),
      activeAccounts: rows.length,
      profitPaidThisYear: profit.paidThisYear.toFixed(2),
      topProfit: profit.top
        ? {
            contactId: profit.top.contactId,
            contactName: contacts.find((contact) => contact.id === profit.top?.contactId)?.name ?? '',
            monthly: profit.top.monthly.toFixed(2),
          }
        : null,
      thisMonth: activity.month,
      rows,
    };
  }

  // The principal entries with these loan contacts, each by what it was: a
  // loan given or taken (a sale or purchase on credit) or money back (a
  // payment, received against the receivable or paid against the payable).
  // Loan principal moved between two Dhaka days ('YYYY-MM-DD', both
  // included), by kind, in taka: the dashboard's cash flow line for Loans.
  async loanFlow(businessId: string, from: string, to: string): Promise<Record<'GAVE' | 'TOOK' | 'GOT_BACK' | 'PAID_BACK', number>> {
    const contacts = await this.prisma.contact.findMany({ where: { businessId, category: 'LOAN' }, select: { id: true } });
    const sums = { GAVE: 0, TOOK: 0, GOT_BACK: 0, PAID_BACK: 0 };
    for (const posting of await this.loanPrincipalPostings(businessId, contacts)) {
      const day = dhakaDateKey(posting.date);
      if (day >= from && day <= to && posting.kind in sums) sums[posting.kind as keyof typeof sums] += posting.amount;
    }
    return sums;
  }

  // Loan Management over a period, for Reports: what moved between two
  // Dhaka days (both included) by kind, profit or interest either way, each
  // entry (newest first), and what people owed you and you owed when each
  // of `days` ended. A contact's balance is its opening balance, plus loans
  // given and repaid by you, less loans taken and money got back.
  async loanPeriod(businessId: string, from: string, to: string, days: string[]) {
    const contacts = await this.prisma.contact.findMany({ where: { businessId, category: 'LOAN' }, select: { id: true, name: true, openingBalance: true } });
    const nameOf = new Map(contacts.map((contact) => [contact.id, contact.name]));
    const [principal, profit] = await Promise.all([
      this.loanPrincipalPostings(businessId, contacts),
      contacts.length
        ? this.prisma.transaction.findMany({
            where: {
              businessId,
              contactId: { in: contacts.map((contact) => contact.id) },
              transactionType: { in: ['INCOME', 'EXPENSE'] },
              status: 'POSTED',
              reversalOfId: null,
              chargeForId: null,
              transactionDate: { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) },
            },
            select: { contactId: true, transactionDate: true, transactionType: true, entries: { where: { entryType: 'DEBIT' }, select: { amount: true } } },
          })
        : [],
    ]);
    const sums = { GAVE: 0, TOOK: 0, GOT_BACK: 0, PAID_BACK: 0, PROFIT_PAID: 0, PROFIT_RECEIVED: 0 };
    const entries: { date: string; contactId: string; name: string; kind: LoanEntryKind; amount: number }[] = [];
    for (const posting of principal) {
      const day = dhakaDateKey(posting.date);
      if (day < from || day > to) continue;
      sums[posting.kind] += posting.amount;
      entries.push({ date: day, contactId: posting.contactId, name: nameOf.get(posting.contactId) ?? '', kind: posting.kind, amount: posting.amount });
    }
    for (const posting of profit) {
      const kind: LoanEntryKind = posting.transactionType === 'EXPENSE' ? 'PROFIT_PAID' : 'PROFIT_RECEIVED';
      const amount = posting.entries.reduce((sum, entry) => sum + Number(entry.amount), 0);
      sums[kind] += amount;
      entries.push({ date: dhakaDateKey(posting.transactionDate), contactId: posting.contactId as string, name: nameOf.get(posting.contactId as string) ?? '', kind, amount });
    }
    entries.sort((a, b) => b.date.localeCompare(a.date));
    return { sums, entries: entries.slice(0, 100), at: loanBalancesOn(contacts, principal, days) };
  }

  // What people owed you (pawna) and you owed (dena) when each Dhaka day
  // ended, and how many on each side: the net worth on any day.
  async loanBalancesAt(businessId: string, days: string[]) {
    const contacts = await this.prisma.contact.findMany({ where: { businessId, category: 'LOAN' }, select: { id: true, openingBalance: true } });
    return loanBalancesOn(contacts, await this.loanPrincipalPostings(businessId, contacts), days);
  }

  private async loanPrincipalPostings(businessId: string, contacts: Pick<Contact, 'id'>[]): Promise<LoanActivityPosting[]> {
    if (contacts.length === 0) return [];
    const receivable = await this.findSystemAccount(this.prisma, businessId, 'receivable', 'ASSET');
    const payable = await this.findSystemAccount(this.prisma, businessId, 'payable', 'LIABILITY');
    const postings = await this.prisma.transaction.findMany({
      where: { businessId, contactId: { in: contacts.map((contact) => contact.id) }, transactionType: { in: ['SALE', 'PURCHASE', 'PAYMENT'] }, status: 'POSTED', reversalOfId: null },
      select: { contactId: true, transactionType: true, transactionDate: true, createdAt: true, entries: { select: { accountId: true, amount: true } } },
    });
    const on = (posting: (typeof postings)[number], account: Account | null) => posting.entries.filter((entry) => account && entry.accountId === account.id).reduce((sum, entry) => sum + Number(entry.amount), 0);
    return postings.flatMap((posting) => {
      const toReceivable = on(posting, receivable);
      const toPayable = on(posting, payable);
      const kind: LoanEntryKind | null =
        posting.transactionType === 'SALE' ? 'GAVE' : posting.transactionType === 'PURCHASE' ? 'TOOK' : toReceivable > 0 ? 'GOT_BACK' : toPayable > 0 ? 'PAID_BACK' : null;
      if (!kind || !posting.contactId) return [];
      const amount = kind === 'GAVE' || kind === 'GOT_BACK' ? toReceivable : toPayable;
      return [{ contactId: posting.contactId, kind, amount, date: posting.transactionDate, createdAt: posting.createdAt }];
    });
  }

  // ---------------------------------------------------------------------
  // Part B: the core remaining-balance calculation. For a contact and a
  // direction (RECEIVABLE reads SALE transactions against the Accounts
  // Receivable account; PAYABLE reads PURCHASE against Accounts Payable),
  // the allocation rules are in direction-breakdown.ts.
  // ---------------------------------------------------------------------
  async computeDirection(
    businessId: string,
    contact: Pick<Contact, 'id' | 'openingBalance'>,
    direction: Direction,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<DirectionBreakdown> {
    const breakdowns = await this.computeDirections(businessId, [contact], direction, client);
    return breakdowns.get(contact.id)!;
  }

  // The same for many contacts at once: three queries whatever their
  // number, where one contact at a time cost three each (the loan
  // dashboard and the contact lists did that for every contact, six with
  // both sides, one after another).
  async computeDirections(
    businessId: string,
    contacts: Pick<Contact, 'id' | 'openingBalance'>[],
    direction: Direction,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<Map<string, DirectionBreakdown>> {
    const invoiceType = direction === 'RECEIVABLE' ? 'SALE' : 'PURCHASE';
    const subtype = direction === 'RECEIVABLE' ? 'receivable' : 'payable';
    const accountType: AccountType = direction === 'RECEIVABLE' ? 'ASSET' : 'LIABILITY';
    const account = await this.findSystemAccount(client, businessId, subtype, accountType);
    const contactIds = contacts.map((contact) => contact.id);

    // Sequential, not Promise.all -- this local dev Postgres has been prone
    // to dropping connections under concurrent query load.
    let invoices: DirectionPosting[] = [];
    let payments: (DirectionPosting & { contactId: string | null })[] = [];
    if (account && contactIds.length > 0) {
      invoices = await client.transaction.findMany({
        where: { businessId, contactId: { in: contactIds }, transactionType: invoiceType, status: 'POSTED', reversalOfId: null },
        include: { entries: true },
        orderBy: [{ transactionDate: 'asc' }, { createdAt: 'asc' }],
      });
      payments = await client.transaction.findMany({
        where: { businessId, contactId: { in: contactIds }, transactionType: 'PAYMENT', status: 'POSTED', reversalOfId: null },
        include: { entries: true },
      });
    }

    // Each contact's own postings, oldest invoice first as the query gave them.
    const byContact = <T extends { contactId?: string | null }>(rows: T[]) => {
      const grouped = new Map<string, T[]>();
      for (const row of rows) {
        if (!row.contactId) continue;
        const list = grouped.get(row.contactId);
        if (list) list.push(row);
        else grouped.set(row.contactId, [row]);
      }
      return grouped;
    };
    const invoicesOf = byContact(invoices as (DirectionPosting & { contactId: string | null })[]);
    const paymentsOf = byContact(payments);

    const today = todayUtcMidnight();
    return new Map(
      contacts.map((contact) => [
        contact.id,
        directionBreakdown(contact.openingBalance, direction, account?.id ?? null, invoicesOf.get(contact.id) ?? [], paymentsOf.get(contact.id) ?? [], today),
      ]),
    );
  }

  // Every contact's balance: their opening balance plus what they owe on the
  // receivable side, minus the payable side -- getContactCurrentBalance()
  // for a whole list in six queries.
  async getContactCurrentBalances(businessId: string, contacts: Pick<Contact, 'id' | 'openingBalance'>[]): Promise<Map<string, Prisma.Decimal>> {
    const receivable = await this.computeDirections(businessId, contacts, 'RECEIVABLE');
    const payable = await this.computeDirections(businessId, contacts, 'PAYABLE');
    return new Map(
      contacts.map((contact) => [
        contact.id,
        new Prisma.Decimal(contact.openingBalance).plus(receivable.get(contact.id)!.balance).minus(payable.get(contact.id)!.balance),
      ]),
    );
  }

  // The contacts aging, overdue and due-soon read. Without a category, and
  // for BUSINESS, the type rule they have always had: Customer/Both on the
  // receivable side, Supplier/Both on the payable side. For LOAN, every loan
  // contact whatever its type -- Loans also offers Relative, Bank, NGO and
  // Other, and those carry opening balances and take payments too. A contact
  // with nothing on a side breaks down to zero there and gets no row, so the
  // wider set adds nothing that is not owed.
  private dueContactsWhere(businessId: string, direction: Direction, category?: ContactCategory): Prisma.ContactWhereInput {
    if (category === 'LOAN') return { businessId, category };
    const contactType = direction === 'RECEIVABLE' ? 'CUSTOMER' : 'SUPPLIER';
    return { businessId, type: { in: [contactType, 'BOTH'] }, ...(category && { category }) };
  }

  private bucketFor(dueDate: Date | null, today: Date): AgingBucket {
    if (!dueDate || dueDate.getTime() >= today.getTime()) return 'current';
    const daysOverdue = Math.floor((today.getTime() - dueDate.getTime()) / DAY_MS);
    if (daysOverdue <= 30) return 'days1to30';
    if (daysOverdue <= 60) return 'days31to60';
    return 'over60';
  }

  // A general payment may settle the outstanding invoices and the contact's
  // opening balance -- what they already owed (Pawna, positive) or were owed
  // (Dena, negative) when the contact was added. That balance has no invoice
  // of its own, so without it an opening balance could never be paid or
  // collected, and the contact never archived.
  private async validatePaymentAmount(
    businessId: string,
    contact: Contact,
    direction: Direction,
    amount: number,
    appliedToTransactionId: string | undefined,
    client: Prisma.TransactionClient,
  ) {
    const breakdown = await this.computeDirection(businessId, contact, direction, client);
    const amt = new Prisma.Decimal(amount);
    const outstanding = new Prisma.Decimal(breakdown.remaining).plus(breakdown.openingRemaining);

    if (appliedToTransactionId) {
      const target = breakdown.transactions.find((t) => t.transactionId === appliedToTransactionId);
      if (!target) {
        throw new BadRequestException('appliedToTransactionId does not reference an outstanding transaction for this contact');
      }
      if (amt.greaterThan(target.remainingAmount)) {
        throw new BadRequestException(`Payment amount (${amt.toFixed(2)}) exceeds the remaining balance (${target.remainingAmount}) of this transaction`);
      }
    } else if (amt.greaterThan(outstanding)) {
      throw new BadRequestException(`Payment amount (${amt.toFixed(2)}) exceeds the total outstanding balance (${outstanding.toFixed(2)})`);
    }
  }

  private async requireContact(businessId: string, contactId: string): Promise<Contact> {
    const contact = await this.prisma.contact.findUnique({ where: { id: contactId } });
    if (!contact || contact.businessId !== businessId) {
      throw new NotFoundException('Contact not found');
    }
    return contact;
  }

  // The seeded Accounts Receivable/Payable: system rows only, oldest first,
  // so an account a user gives the same subtype is never picked instead.
  private findSystemAccount(client: Prisma.TransactionClient, businessId: string, subtype: string, accountType: AccountType): Promise<Account | null> {
    return client.account.findFirst({ where: { businessId, accountSubtype: subtype, accountType, isSystemAccount: true }, orderBy: { createdAt: 'asc' } });
  }

  private async requireSystemAccount(businessId: string, subtype: string, accountType: AccountType, label: string): Promise<Account> {
    const account = await this.findSystemAccount(this.prisma, businessId, subtype, accountType);
    if (!account) {
      throw new BadRequestException(`No ${label} account exists in this workspace -- it should have been auto-created; contact support`);
    }
    return account;
  }

  private async requireMoneyAccount(businessId: string, accountId: string): Promise<Account> {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account || account.businessId !== businessId) {
      throw new BadRequestException('moneyAccountId: account not found in this workspace');
    }
    if (account.accountType !== 'ASSET' || !account.accountSubtype || !MONEY_ACCOUNT_SUBTYPES.includes(account.accountSubtype)) {
      throw new BadRequestException('moneyAccountId must be a cash/bank/mobile-money account');
    }
    return account;
  }

  // Same validation as requireMoneyAccount(), plus the "was it even
  // provided" check recordSale()/recordPurchase() need for a LOAN contact
  // -- moneyAccountId is optional on the DTO (irrelevant for BUSINESS
  // contacts), so this is where it becomes mandatory once category: LOAN
  // is known.
  private async requireMoneyAccountForLoan(businessId: string, moneyAccountId: string | undefined): Promise<Account> {
    if (!moneyAccountId) {
      throw new BadRequestException('moneyAccountId is required for a loan (real cash moves through an account, unlike a business credit sale/purchase)');
    }
    return this.requireMoneyAccount(businessId, moneyAccountId);
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

  // Same "lowest displayOrder wins" convention as QuickEntriesService's
  // getDefaultIncomeAccountId() -- duplicated rather than imported since
  // QuickEntriesService isn't exported from its module (small, self-
  // contained helper, same tolerance for this as MONEY_ACCOUNT_SUBTYPES
  // being a plain imported constant rather than a DI call).
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

  private async getDefaultExpenseAccountId(businessId: string): Promise<string> {
    const account = await this.prisma.account.findFirst({
      where: { businessId, accountType: 'EXPENSE', status: 'ACTIVE' },
      // Oldest first among equal display orders: accounts a user adds
      // default to 0 too, and the seeded one should win the tie.
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    });
    if (!account) {
      throw new BadRequestException('No expense account exists in this workspace -- specify expenseAccountId or create one first');
    }
    return account.id;
  }
}

// A contact's balance on a day: its opening balance, plus loans given and
// repaid by you, less loans taken and money got back by then.
const LOAN_SIGN: Record<LoanEntryKind, number> = { GAVE: 1, PAID_BACK: 1, TOOK: -1, GOT_BACK: -1, PROFIT_PAID: 0, PROFIT_RECEIVED: 0 };

function loanBalancesOn(contacts: { id: string; openingBalance: Prisma.Decimal | number | string }[], principal: LoanActivityPosting[], days: string[]) {
  return days.map((day) => {
    let pawna = 0;
    let dena = 0;
    let owesYou = 0;
    let youOwe = 0;
    for (const contact of contacts) {
      const balance = principal
        .filter((posting) => posting.contactId === contact.id && dhakaDateKey(posting.date) <= day)
        .reduce((sum, posting) => sum + LOAN_SIGN[posting.kind] * posting.amount, Number(contact.openingBalance));
      if (balance > 0.004) {
        pawna += balance;
        owesYou += 1;
      } else if (balance < -0.004) {
        dena -= balance;
        youOwe += 1;
      }
    }
    return { day, pawna, dena, owesYou, youOwe };
  });
}
