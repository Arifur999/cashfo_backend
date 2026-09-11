import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Account, AccountType, Contact, Prisma, TransactionStatus } from '@prisma/client';
import { MONEY_ACCOUNT_SUBTYPES } from '../accounts/accounts.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TransactionsService } from '../transactions/transactions.service.js';
import { CreatePayableDto } from './dto/create-payable.dto.js';
import { CreateReceivableDto } from './dto/create-receivable.dto.js';
import { PayPaymentDto } from './dto/pay-payment.dto.js';
import { ReceivePaymentDto } from './dto/receive-payment.dto.js';

export type Direction = 'RECEIVABLE' | 'PAYABLE';

export interface InvoiceBreakdown {
  transactionId: string;
  date: Date;
  description: string | null;
  originalAmount: string;
  amountPaid: string;
  remainingAmount: string;
  dueDate: Date | null;
  isOverdue: boolean;
}

export interface DirectionBreakdown {
  totalInvoiced: string;
  totalPaid: string;
  remaining: string;
  transactions: InvoiceBreakdown[];
}

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
}

export interface AgingReport {
  buckets: { current: string; days1to30: string; days31to60: string; over60: string };
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
  currentBalance: string;
  direction: LoanBalanceDirection;
}

export interface LoanDashboard {
  totalDena: string;
  totalPawna: string;
  totalPaid: string;
  totalReceived: string;
  netBalance: string;
  activeAccounts: number;
  rows: LoanDashboardRow[];
}

export interface LoanStatementRow {
  transactionId: string;
  date: Date;
  referenceNo: string | null;
  description: string | null;
  category: string;
  // DEBIT on the AR/AP side of a transaction always mirrors a CREDIT on
  // that same transaction's money-account side (double-entry) -- which is
  // exactly the "cash left the business" case (a loan given out, or a
  // payment made on money borrowed). So debit here means "Paid" and
  // credit means "Received", regardless of whether the entry happens to
  // sit on the Accounts Receivable or the Accounts Payable account.
  debit: string | null;
  credit: string | null;
  runningPrincipal: string;
  status: TransactionStatus;
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

function todayUtcMidnight(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

const DAY_MS = 24 * 60 * 60 * 1000;

// The whole point of this module (per the product blueprint): Receivable/
// Payable are NOT a parallel data structure -- they're the "Accounts
// Receivable"/"Accounts Payable" system accounts from Prompt 4's Chart of
// Accounts, viewed through a contact-centric lens, using the exact same
// Transaction Engine from Prompt 5 (SALE/PURCHASE/PAYMENT are transaction
// types that already existed in that schema). Every write here is just
// "which two accounts, which direction" handed to
// TransactionsService.createTransaction() -- same wrapper pattern as
// Prompt 6's QuickEntriesService.
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
  async recordSale(businessId: string, dto: CreateReceivableDto, userId: string) {
    const contact = await this.requireContact(businessId, dto.contactId);
    if (contact.type !== 'CUSTOMER' && contact.type !== 'BOTH') {
      throw new BadRequestException('This contact must be a Customer (or Customer & Supplier) to record a credit sale');
    }
    const arAccount = await this.requireSystemAccount(businessId, 'receivable', 'ASSET', 'Accounts Receivable');

    const otherEntry =
      contact.category === 'LOAN'
        ? { accountId: (await this.requireMoneyAccountForLoan(businessId, dto.moneyAccountId)).id, entryType: 'CREDIT' as const }
        : {
            accountId: (
              await this.requireAccountOfType(businessId, dto.incomeAccountId ?? (await this.getDefaultIncomeAccountId(businessId)), 'INCOME', 'incomeAccountId')
            ).id,
            entryType: 'CREDIT' as const,
          };

    return this.transactionsService.createTransaction(
      businessId,
      {
        transactionType: 'SALE',
        transactionDate: dto.date,
        dueDate: dto.dueDate,
        description: dto.description,
        contactId: contact.id,
        entries: [
          { accountId: arAccount.id, entryType: 'DEBIT', amount: dto.amount },
          { accountId: otherEntry.accountId, entryType: otherEntry.entryType, amount: dto.amount },
        ],
      },
      userId,
    );
  }

  // Mirror of recordSale() above -- for BUSINESS this is a credit purchase
  // (expense recognized, Dr Expense / Cr Accounts Payable); for LOAN this
  // is taking out a loan (real cash lands in a money account right now,
  // none of it an expense: Dr the money account / Cr Accounts Payable).
  async recordPurchase(businessId: string, dto: CreatePayableDto, userId: string) {
    const contact = await this.requireContact(businessId, dto.contactId);
    if (contact.type !== 'SUPPLIER' && contact.type !== 'BOTH') {
      throw new BadRequestException('This contact must be a Supplier (or Customer & Supplier) to record a credit purchase');
    }
    const apAccount = await this.requireSystemAccount(businessId, 'payable', 'LIABILITY', 'Accounts Payable');

    const debitAccountId =
      contact.category === 'LOAN'
        ? (await this.requireMoneyAccountForLoan(businessId, dto.moneyAccountId)).id
        : (
            await this.requireAccountOfType(businessId, dto.expenseAccountId ?? (await this.getDefaultExpenseAccountId(businessId)), 'EXPENSE', 'expenseAccountId')
          ).id;

    return this.transactionsService.createTransaction(
      businessId,
      {
        transactionType: 'PURCHASE',
        transactionDate: dto.date,
        dueDate: dto.dueDate,
        description: dto.description,
        contactId: contact.id,
        entries: [
          { accountId: debitAccountId, entryType: 'DEBIT', amount: dto.amount },
          { accountId: apAccount.id, entryType: 'CREDIT', amount: dto.amount },
        ],
      },
      userId,
    );
  }

  async receivePayment(businessId: string, dto: ReceivePaymentDto, userId: string) {
    const contact = await this.requireContact(businessId, dto.contactId);
    const arAccount = await this.requireSystemAccount(businessId, 'receivable', 'ASSET', 'Accounts Receivable');
    const moneyAccount = await this.requireMoneyAccount(businessId, dto.moneyAccountId);

    await this.validatePaymentAmount(businessId, contact.id, 'RECEIVABLE', dto.amount, dto.appliedToTransactionId);

    return this.transactionsService.createTransaction(
      businessId,
      {
        transactionType: 'PAYMENT',
        transactionDate: dto.date,
        description: dto.description,
        contactId: contact.id,
        appliedToTransactionId: dto.appliedToTransactionId,
        entries: [
          { accountId: moneyAccount.id, entryType: 'DEBIT', amount: dto.amount },
          { accountId: arAccount.id, entryType: 'CREDIT', amount: dto.amount },
        ],
      },
      userId,
    );
  }

  async payPayment(businessId: string, dto: PayPaymentDto, userId: string) {
    const contact = await this.requireContact(businessId, dto.contactId);
    const apAccount = await this.requireSystemAccount(businessId, 'payable', 'LIABILITY', 'Accounts Payable');
    const moneyAccount = await this.requireMoneyAccount(businessId, dto.moneyAccountId);

    await this.validatePaymentAmount(businessId, contact.id, 'PAYABLE', dto.amount, dto.appliedToTransactionId);

    return this.transactionsService.createTransaction(
      businessId,
      {
        transactionType: 'PAYMENT',
        transactionDate: dto.date,
        description: dto.description,
        contactId: contact.id,
        appliedToTransactionId: dto.appliedToTransactionId,
        entries: [
          { accountId: apAccount.id, entryType: 'DEBIT', amount: dto.amount },
          { accountId: moneyAccount.id, entryType: 'CREDIT', amount: dto.amount },
        ],
      },
      userId,
    );
  }

  async getContactBalanceDetail(businessId: string, contactId: string) {
    const contact = await this.requireContact(businessId, contactId);
    // Sequential, not Promise.all -- this local dev Postgres (prisma dev's
    // built-in server, see prisma.config.ts) has shown it can drop
    // connections under even modest concurrent query load; two direction
    // computations for one contact detail page isn't worth that risk.
    const receivable = await this.computeDirection(businessId, contactId, 'RECEIVABLE');
    const payable = await this.computeDirection(businessId, contactId, 'PAYABLE');
    const currentBalance = new Prisma.Decimal(contact.openingBalance).plus(receivable.remaining).minus(payable.remaining);

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
    const receivable = await this.computeDirection(businessId, contact.id, 'RECEIVABLE');
    const payable = await this.computeDirection(businessId, contact.id, 'PAYABLE');
    return new Prisma.Decimal(contact.openingBalance).plus(receivable.remaining).minus(payable.remaining);
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

    const arAccount = await this.prisma.account.findFirst({ where: { businessId, accountSubtype: 'receivable', accountType: 'ASSET' } });
    const apAccount = await this.prisma.account.findFirst({ where: { businessId, accountSubtype: 'payable', accountType: 'LIABILITY' } });
    const accountIds = [arAccount?.id, apAccount?.id].filter((id): id is string => !!id);

    let balanceBroughtForward = new Prisma.Decimal(contact.openingBalance);
    if (filters.dateFrom && accountIds.length > 0) {
      const priorEntries = await this.prisma.transactionEntry.findMany({
        where: { accountId: { in: accountIds }, transaction: { contactId, transactionDate: { lt: new Date(filters.dateFrom) } } },
      });
      for (const entry of priorEntries) {
        const amount = new Prisma.Decimal(entry.amount);
        const delta = entry.entryType === 'DEBIT' ? amount : amount.negated();
        balanceBroughtForward = balanceBroughtForward.plus(delta);
      }
    }

    const dateFilter: Prisma.DateTimeFilter = {};
    if (filters.dateFrom) dateFilter.gte = new Date(filters.dateFrom);
    if (filters.dateTo) dateFilter.lte = new Date(filters.dateTo);
    const hasDateFilter = Object.keys(dateFilter).length > 0;

    const entries =
      accountIds.length === 0
        ? []
        : await this.prisma.transactionEntry.findMany({
            where: {
              accountId: { in: accountIds },
              transaction: { contactId, ...(hasDateFilter && { transactionDate: dateFilter }) },
            },
            include: { transaction: true },
            orderBy: [{ transaction: { transactionDate: 'asc' } }, { transaction: { createdAt: 'asc' } }],
          });

    let running = balanceBroughtForward;
    const rows: LoanStatementRow[] = entries.map((entry) => {
      const amount = new Prisma.Decimal(entry.amount);
      const delta = entry.entryType === 'DEBIT' ? amount : amount.negated();
      running = running.plus(delta);
      return {
        transactionId: entry.transactionId,
        date: entry.transaction.transactionDate,
        referenceNo: entry.transaction.referenceNo,
        description: entry.transaction.description,
        category: 'Principal',
        debit: entry.entryType === 'DEBIT' ? amount.toFixed(2) : null,
        credit: entry.entryType === 'CREDIT' ? amount.toFixed(2) : null,
        runningPrincipal: running.toFixed(2),
        status: entry.transaction.status,
      };
    });

    return {
      contactId,
      contactName: contact.name,
      openingBalance: contact.openingBalance.toFixed(2),
      balanceBroughtForward: balanceBroughtForward.toFixed(2),
      rows,
      closingBalance: rows.length > 0 ? rows[rows.length - 1].runningPrincipal : balanceBroughtForward.toFixed(2),
    };
  }

  async getAging(businessId: string, direction: Direction): Promise<AgingReport> {
    const contactType = direction === 'RECEIVABLE' ? 'CUSTOMER' : 'SUPPLIER';
    // BUSINESS only -- Loan Management contacts (category: LOAN) have their
    // own dashboard (getLoanDashboard()) and must not bleed into Dena-Pawna.
    const contacts = await this.prisma.contact.findMany({
      where: { businessId, category: 'BUSINESS', type: { in: [contactType, 'BOTH'] } },
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

    for (const contact of contacts) {
      const breakdown = await this.computeDirection(businessId, contact.id, direction);
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
      });
    }

    return {
      buckets: {
        current: buckets.current.toFixed(2),
        days1to30: buckets.days1to30.toFixed(2),
        days31to60: buckets.days31to60.toFixed(2),
        over60: buckets.over60.toFixed(2),
      },
      contacts: rows,
    };
  }

  async getOverdue(businessId: string, direction: Direction): Promise<OverdueRow[]> {
    const contactType = direction === 'RECEIVABLE' ? 'CUSTOMER' : 'SUPPLIER';
    // BUSINESS only -- see getAging()'s comment.
    const contacts = await this.prisma.contact.findMany({
      where: { businessId, category: 'BUSINESS', type: { in: [contactType, 'BOTH'] } },
    });

    const today = todayUtcMidnight();
    const rows: OverdueRow[] = [];
    for (const contact of contacts) {
      const breakdown = await this.computeDirection(businessId, contact.id, direction);
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

  // Loan Management's dashboard -- same engine as Dena-Pawna
  // (computeDirection() against the same Accounts Receivable/Payable
  // accounts), scoped to category: LOAN contacts (banks/persons you lend
  // to or borrow from) instead of BUSINESS ones (customers/suppliers).
  // "Record Sale on Credit" = give a loan (Pawna, they owe you); "Record
  // Purchase on Credit" = take a loan (Dena, you owe them); the existing
  // payment endpoints settle either side -- no new write path needed,
  // this is purely a themed read view over the same data.
  async getLoanDashboard(businessId: string): Promise<LoanDashboard> {
    const contacts = await this.prisma.contact.findMany({
      where: { businessId, category: 'LOAN' },
      orderBy: { name: 'asc' },
    });

    let totalDena = new Prisma.Decimal(0);
    let totalPawna = new Prisma.Decimal(0);
    let totalPaid = new Prisma.Decimal(0);
    let totalReceived = new Prisma.Decimal(0);
    const rows: LoanDashboardRow[] = [];

    for (const contact of contacts) {
      const receivable = await this.computeDirection(businessId, contact.id, 'RECEIVABLE');
      const payable = await this.computeDirection(businessId, contact.id, 'PAYABLE');
      const opening = new Prisma.Decimal(contact.openingBalance);
      const currentBalance = opening.plus(receivable.remaining).minus(payable.remaining);

      // Cash paid out = loans given (receivable.totalInvoiced) + loans
      // repaid (payable.totalPaid). Cash received = loans taken
      // (payable.totalInvoiced) + repayments collected (receivable.totalPaid).
      const totalPayment = new Prisma.Decimal(receivable.totalInvoiced).plus(payable.totalPaid);
      const totalReceive = new Prisma.Decimal(payable.totalInvoiced).plus(receivable.totalPaid);

      if (opening.equals(0) && totalPayment.equals(0) && totalReceive.equals(0)) continue;

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
        currentBalance: currentBalance.toFixed(2),
        direction,
      });
    }

    return {
      totalDena: totalDena.toFixed(2),
      totalPawna: totalPawna.toFixed(2),
      totalPaid: totalPaid.toFixed(2),
      totalReceived: totalReceived.toFixed(2),
      netBalance: totalPawna.minus(totalDena).toFixed(2),
      activeAccounts: rows.length,
      rows,
    };
  }

  // ---------------------------------------------------------------------
  // Part B: the core remaining-balance calculation. For a contact and a
  // direction (RECEIVABLE reads SALE transactions against the Accounts
  // Receivable account; PAYABLE reads PURCHASE against Accounts Payable):
  //
  // 1. Payments with `appliedToTransactionId` set reduce that specific
  //    invoice's remaining balance directly.
  // 2. Payments without a target are pooled and allocated FIFO -- oldest
  //    outstanding invoice first -- until the pool is exhausted.
  //
  // This is entirely a read-time computation. TransactionEntry rows are
  // never split or rewritten to reflect an allocation -- the ledger/trial
  // balance (Prompt 7) only ever sees the original, simple 2-entry
  // transactions, so those stay correct regardless of how payments get
  // allocated here.
  // ---------------------------------------------------------------------
  async computeDirection(businessId: string, contactId: string, direction: Direction): Promise<DirectionBreakdown> {
    const invoiceType = direction === 'RECEIVABLE' ? 'SALE' : 'PURCHASE';
    const subtype = direction === 'RECEIVABLE' ? 'receivable' : 'payable';
    const accountType: AccountType = direction === 'RECEIVABLE' ? 'ASSET' : 'LIABILITY';

    const account = await this.prisma.account.findFirst({ where: { businessId, accountSubtype: subtype, accountType } });
    if (!account) {
      return { totalInvoiced: '0.00', totalPaid: '0.00', remaining: '0.00', transactions: [] };
    }

    // Sequential, not Promise.all -- this local dev Postgres (prisma dev's
    // built-in server) has grown increasingly prone to dropping connections
    // under concurrent query load over the course of long sessions; with
    // getLoanDashboard() now calling this twice (RECEIVABLE + PAYABLE) per
    // contact in a loop, removing this last bit of internal concurrency is
    // worth the small latency cost.
    const invoices = await this.prisma.transaction.findMany({
      where: { businessId, contactId, transactionType: invoiceType, status: 'POSTED' },
      include: { entries: true },
      orderBy: [{ transactionDate: 'asc' }, { createdAt: 'asc' }],
    });
    const payments = await this.prisma.transaction.findMany({
      where: { businessId, contactId, transactionType: 'PAYMENT', status: 'POSTED' },
      include: { entries: true },
    });

    // A contact of type BOTH can have both a receivable and a payable
    // relationship -- only count payments that actually touch THIS
    // direction's account, so the two pools never mix.
    const relevantPayments = payments.filter((p) => p.entries.some((e) => e.accountId === account.id));

    const originalAmount = new Map<string, Prisma.Decimal>();
    for (const inv of invoices) {
      const entry = inv.entries.find((e) => e.accountId === account.id);
      originalAmount.set(inv.id, entry ? new Prisma.Decimal(entry.amount) : new Prisma.Decimal(0));
    }

    const amountPaid = new Map<string, Prisma.Decimal>(invoices.map((inv) => [inv.id, new Prisma.Decimal(0)]));

    let generalPool = new Prisma.Decimal(0);
    for (const p of relevantPayments) {
      const entry = p.entries.find((e) => e.accountId === account.id);
      const amt = entry ? new Prisma.Decimal(entry.amount) : new Prisma.Decimal(0);
      if (p.appliedToTransactionId && amountPaid.has(p.appliedToTransactionId)) {
        amountPaid.set(p.appliedToTransactionId, amountPaid.get(p.appliedToTransactionId)!.plus(amt));
      } else {
        generalPool = generalPool.plus(amt);
      }
    }

    // FIFO: invoices are already ordered oldest-first from the query above.
    for (const inv of invoices) {
      if (generalPool.lessThanOrEqualTo(0)) break;
      const remaining = originalAmount.get(inv.id)!.minus(amountPaid.get(inv.id)!);
      if (remaining.lessThanOrEqualTo(0)) continue;
      const take = Prisma.Decimal.min(remaining, generalPool);
      amountPaid.set(inv.id, amountPaid.get(inv.id)!.plus(take));
      generalPool = generalPool.minus(take);
    }

    const today = todayUtcMidnight();
    const transactions: InvoiceBreakdown[] = invoices.map((inv) => {
      const original = originalAmount.get(inv.id)!;
      const paid = amountPaid.get(inv.id)!;
      const remaining = Prisma.Decimal.max(0, original.minus(paid));
      const isOverdue = !!inv.dueDate && inv.dueDate.getTime() < today.getTime() && remaining.greaterThan(0);
      return {
        transactionId: inv.id,
        date: inv.transactionDate,
        description: inv.description,
        originalAmount: original.toFixed(2),
        amountPaid: paid.toFixed(2),
        remainingAmount: remaining.toFixed(2),
        dueDate: inv.dueDate,
        isOverdue,
      };
    });

    const totalInvoiced = transactions.reduce((sum, t) => sum.plus(t.originalAmount), new Prisma.Decimal(0));
    const totalPaid = relevantPayments.reduce((sum, p) => {
      const entry = p.entries.find((e) => e.accountId === account.id);
      return sum.plus(entry ? entry.amount : 0);
    }, new Prisma.Decimal(0));

    return {
      totalInvoiced: totalInvoiced.toFixed(2),
      totalPaid: totalPaid.toFixed(2),
      remaining: totalInvoiced.minus(totalPaid).toFixed(2),
      transactions,
    };
  }

  private bucketFor(dueDate: Date | null, today: Date): AgingBucket {
    if (!dueDate || dueDate.getTime() >= today.getTime()) return 'current';
    const daysOverdue = Math.floor((today.getTime() - dueDate.getTime()) / DAY_MS);
    if (daysOverdue <= 30) return 'days1to30';
    if (daysOverdue <= 60) return 'days31to60';
    return 'over60';
  }

  private async validatePaymentAmount(
    businessId: string,
    contactId: string,
    direction: Direction,
    amount: number,
    appliedToTransactionId?: string,
  ) {
    const breakdown = await this.computeDirection(businessId, contactId, direction);
    const amt = new Prisma.Decimal(amount);

    if (appliedToTransactionId) {
      const target = breakdown.transactions.find((t) => t.transactionId === appliedToTransactionId);
      if (!target) {
        throw new BadRequestException('appliedToTransactionId does not reference an outstanding transaction for this contact');
      }
      if (amt.greaterThan(target.remainingAmount)) {
        throw new BadRequestException(
          `Payment amount (${amt.toFixed(2)}) exceeds the remaining balance (${target.remainingAmount}) of this transaction`,
        );
      }
    } else if (amt.greaterThan(breakdown.remaining)) {
      throw new BadRequestException(`Payment amount (${amt.toFixed(2)}) exceeds the total outstanding balance (${breakdown.remaining})`);
    }
  }

  private async requireContact(businessId: string, contactId: string): Promise<Contact> {
    const contact = await this.prisma.contact.findUnique({ where: { id: contactId } });
    if (!contact || contact.businessId !== businessId) {
      throw new NotFoundException('Contact not found');
    }
    return contact;
  }

  private async requireSystemAccount(businessId: string, subtype: string, accountType: AccountType, label: string): Promise<Account> {
    const account = await this.prisma.account.findFirst({ where: { businessId, accountSubtype: subtype, accountType } });
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
      orderBy: { displayOrder: 'asc' },
    });
    if (!account) {
      throw new BadRequestException('No income account exists in this workspace -- specify incomeAccountId or create one first');
    }
    return account.id;
  }

  private async getDefaultExpenseAccountId(businessId: string): Promise<string> {
    const account = await this.prisma.account.findFirst({
      where: { businessId, accountType: 'EXPENSE', status: 'ACTIVE' },
      orderBy: { displayOrder: 'asc' },
    });
    if (!account) {
      throw new BadRequestException('No expense account exists in this workspace -- specify expenseAccountId or create one first');
    }
    return account.id;
  }
}
