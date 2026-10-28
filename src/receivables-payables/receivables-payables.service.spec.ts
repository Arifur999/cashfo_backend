import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ContactCategoryQueryDto } from './dto/contact-category-query.dto.js';
import { DueSoonQueryDto } from './dto/due-soon-query.dto.js';
import { ReceivablesPayablesController } from './receivables-payables.controller.js';
import { ReceivablesPayablesService } from './receivables-payables.service.js';

type Category = 'BUSINESS' | 'LOAN';
type Contact = { id: string; businessId: string; name: string; type: string; category: Category; openingBalance: Prisma.Decimal };
type Entry = { accountId: string; entryType: 'DEBIT' | 'CREDIT'; amount: Prisma.Decimal };
type Posting = {
  id: string;
  businessId: string;
  contactId: string;
  transactionType: 'SALE' | 'PURCHASE' | 'PAYMENT';
  transactionDate: Date;
  createdAt: Date;
  description: string;
  dueDate: Date | null;
  appliedToTransactionId: string | null;
  status: 'POSTED' | 'VOIDED';
  reversalOfId: string | null;
  entries: Entry[];
};

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const contact = (id: string, name: string, type: string, category: Category, openingBalance = '0', businessId = 'biz-1'): Contact => ({
  id,
  businessId,
  name,
  type,
  category,
  openingBalance: new Prisma.Decimal(openingBalance),
});
const posting = (
  id: string,
  contactId: string,
  transactionType: Posting['transactionType'],
  date: string,
  entries: Entry[],
  over: Partial<Posting> = {},
): Posting => ({
  id,
  businessId: 'biz-1',
  contactId,
  transactionType,
  transactionDate: day(date),
  createdAt: day(date),
  description: id,
  dueDate: null,
  appliedToTransactionId: null,
  status: 'POSTED',
  reversalOfId: null,
  entries,
  ...over,
});
const line = (accountId: string, entryType: Entry['entryType'], amount: string): Entry => ({ accountId, entryType, amount: new Prisma.Decimal(amount) });
// Dr Receivable / Cr Sales, due on `due`.
const sale = (id: string, contactId: string, date: string, amount: string, due: string, over: Partial<Posting> = {}) =>
  posting(id, contactId, 'SALE', date, [line('ar', 'DEBIT', amount), line('sales', 'CREDIT', amount)], { dueDate: day(due), ...over });
// A general payment from them: Dr Cash / Cr Receivable.
const received = (id: string, contactId: string, date: string, amount: string) =>
  posting(id, contactId, 'PAYMENT', date, [line('cash', 'DEBIT', amount), line('ar', 'CREDIT', amount)]);
// A general payment to them: Dr Payable / Cr Cash.
const paid = (id: string, contactId: string, date: string, amount: string) =>
  posting(id, contactId, 'PAYMENT', date, [line('ap', 'DEBIT', amount), line('cash', 'CREDIT', amount)]);

// Today is 21 October 2026 in Dhaka.
const TODAY = '2026-10-21';

const contacts = [
  // Business: owed 300 from before, then a sale of 1000 well past due, and 500
  // paid -- the 300 goes first, so 800 is left on the sale.
  contact('shop', 'Shop', 'CUSTOMER', 'BUSINESS', '300'),
  // Business: 250 from before, untouched, and a sale due in two days.
  contact('trader', 'Trader', 'CUSTOMER', 'BUSINESS', '250'),
  // Loans: lent 5000, due in four days.
  contact('lender', 'Lender', 'BOTH', 'LOAN'),
  // Loans: 2000 from before, 500 of it paid back, no invoice -- no row.
  contact('friend', 'Friend', 'BOTH', 'LOAN', '2000'),
  // Loans: a bank lent us 5000 from before, 1000 of it paid back. Not a
  // Supplier or Both, so only the LOAN lens reads it.
  contact('bank', 'Bank', 'BANK', 'LOAN', '-5000'),
  // Not a customer, and not this workspace's: never looked at.
  contact('supplier', 'Supplier', 'SUPPLIER', 'BUSINESS', '-900'),
  contact('stranger', 'Stranger', 'CUSTOMER', 'BUSINESS', '777', 'biz-2'),
];

const postings = [
  sale('shop-sale', 'shop', '2026-08-01', '1000', '2026-09-01'),
  received('shop-paid', 'shop', '2026-09-15', '500'),
  sale('shop-void', 'shop', '2026-08-02', '4000', '2026-09-01', { status: 'VOIDED' }),
  sale('trader-sale', 'trader', '2026-10-10', '400', '2026-10-23'),
  sale('lender-loan', 'lender', '2026-10-01', '5000', '2026-10-25'),
  received('friend-paid', 'friend', '2026-10-02', '500'),
  paid('bank-paid', 'bank', '2026-10-05', '1000'),
];

// Just enough of Prisma's where semantics for what aging, overdue and
// due-soon send; anything else fails loudly rather than matching by accident.
const contactMatches = (row: Contact, where: Record<string, unknown>) =>
  Object.entries(where).every(([key, value]) => {
    if (key === 'businessId' || key === 'category') return row[key] === value;
    if (key === 'type' || key === 'id') return (value as { in: string[] }).in.includes(row[key]);
    throw new Error(`The fake contacts do not support filtering on ${key}`);
  });

const postingMatches = (row: Posting, where: Record<string, unknown>) =>
  Object.entries(where).every(([key, value]) => {
    if (key === 'businessId' || key === 'transactionType' || key === 'status' || key === 'reversalOfId') return row[key] === value;
    if (key === 'contactId') return (value as { in: string[] }).in.includes(row.contactId);
    throw new Error(`The fake postings do not support filtering on ${key}`);
  });

const setup = () => {
  const prisma = {
    contact: {
      findMany: vi.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(contacts.filter((row) => contactMatches(row, where)).sort((a, b) => a.name.localeCompare(b.name))),
      ),
    },
    account: {
      findFirst: vi.fn(({ where }: { where: { businessId: string; accountSubtype: string } }) =>
        Promise.resolve(where.businessId === 'biz-1' ? { id: where.accountSubtype === 'receivable' ? 'ar' : 'ap', businessId: 'biz-1' } : null),
      ),
    },
    transaction: {
      findMany: vi.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(postings.filter((row) => postingMatches(row, where)).sort((a, b) => a.transactionDate.getTime() - b.transactionDate.getTime())),
      ),
    },
  };
  return { service: new ReceivablesPayablesService(prisma as never, {} as never), prisma };
};

const contactWhere = (prisma: ReturnType<typeof setup>['prisma']) => prisma.contact.findMany.mock.calls[0][0].where;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${TODAY}T06:00:00.000Z`));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ReceivablesPayablesService.getAging', () => {
  it('reads every contact as before when no category is named, with what is owed from before', async () => {
    const { service, prisma } = setup();
    const report = await service.getAging('biz-1', 'RECEIVABLE');

    expect(contactWhere(prisma)).toEqual({ businessId: 'biz-1', type: { in: ['CUSTOMER', 'BOTH'] } });
    expect(report.buckets).toEqual({ current: '5400.00', days1to30: '0.00', days31to60: '800.00', over60: '0.00' });
    expect(report.contacts).toEqual([
      {
        contactId: 'lender',
        contactName: 'Lender',
        current: '5000.00',
        days1to30: '0.00',
        days31to60: '0.00',
        over60: '0.00',
        total: '5000.00',
        totalInvoiced: '5000.00',
        totalPaid: '0.00',
        openingRemaining: '0.00',
      },
      // The 500 paid settled the 300 from before first.
      {
        contactId: 'shop',
        contactName: 'Shop',
        current: '0.00',
        days1to30: '0.00',
        days31to60: '800.00',
        over60: '0.00',
        total: '800.00',
        totalInvoiced: '1000.00',
        totalPaid: '500.00',
        openingRemaining: '0.00',
      },
      {
        contactId: 'trader',
        contactName: 'Trader',
        current: '400.00',
        days1to30: '0.00',
        days31to60: '0.00',
        over60: '0.00',
        total: '400.00',
        totalInvoiced: '400.00',
        totalPaid: '0.00',
        openingRemaining: '250.00',
      },
    ]);
    // Friend owes only from before, so has no row, but the 1500 still counts.
    expect(report.openingRemaining).toBe('1750.00');
  });

  it("narrows to Books' contacts with category BUSINESS", async () => {
    const { service, prisma } = setup();
    const report = await service.getAging('biz-1', 'RECEIVABLE', 'BUSINESS');

    expect(contactWhere(prisma)).toEqual({ businessId: 'biz-1', type: { in: ['CUSTOMER', 'BOTH'] }, category: 'BUSINESS' });
    expect(report.contacts.map((row) => row.contactId)).toEqual(['shop', 'trader']);
    expect(report.buckets).toEqual({ current: '400.00', days1to30: '0.00', days31to60: '800.00', over60: '0.00' });
    expect(report.openingRemaining).toBe('250.00');
  });

  it("narrows to Loan Management's contacts with category LOAN", async () => {
    const { service, prisma } = setup();
    const report = await service.getAging('biz-1', 'RECEIVABLE', 'LOAN');

    // Every loan contact, whatever its type.
    expect(contactWhere(prisma)).toEqual({ businessId: 'biz-1', category: 'LOAN' });
    expect(report.contacts.map((row) => [row.contactId, row.total, row.openingRemaining])).toEqual([['lender', '5000.00', '0.00']]);
    expect(report.buckets.current).toBe('5000.00');
    // The bank's -5000 is owed by us, not to us: nothing on this side.
    expect(report.openingRemaining).toBe('1500.00');
  });

  it("counts a Bank loan contact's opening balance on the payable side with category LOAN", async () => {
    const { service, prisma } = setup();
    const report = await service.getAging('biz-1', 'PAYABLE', 'LOAN');

    expect(contactWhere(prisma)).toEqual({ businessId: 'biz-1', category: 'LOAN' });
    // 5000 from before, 1000 paid back: 4000 left, and no invoice, so no row.
    expect(report.contacts).toEqual([]);
    expect(report.openingRemaining).toBe('4000.00');
  });

  it('keeps the type rule without a category, so the bank is never read', async () => {
    const { service, prisma } = setup();
    const report = await service.getAging('biz-1', 'PAYABLE');

    expect(contactWhere(prisma)).toEqual({ businessId: 'biz-1', type: { in: ['SUPPLIER', 'BOTH'] } });
    expect(report.openingRemaining).toBe('900.00');
  });

  it('counts a negative opening balance on the payable side only', async () => {
    const { service, prisma } = setup();
    const report = await service.getAging('biz-1', 'PAYABLE', 'BUSINESS');

    expect(contactWhere(prisma)).toEqual({ businessId: 'biz-1', type: { in: ['SUPPLIER', 'BOTH'] }, category: 'BUSINESS' });
    // The supplier is owed 900 from before and has no purchase.
    expect(report.contacts).toEqual([]);
    expect(report.openingRemaining).toBe('900.00');
  });
});

describe('ReceivablesPayablesService.getOverdue', () => {
  it('lists every late invoice without a category, and only the named kind with one', async () => {
    const all = setup();
    expect((await all.service.getOverdue('biz-1', 'RECEIVABLE')).map((row) => [row.transactionId, row.remainingAmount, row.daysOverdue])).toEqual([
      ['shop-sale', '800.00', 50],
    ]);
    expect(contactWhere(all.prisma)).toEqual({ businessId: 'biz-1', type: { in: ['CUSTOMER', 'BOTH'] } });

    const business = setup();
    expect((await business.service.getOverdue('biz-1', 'RECEIVABLE', 'BUSINESS')).map((row) => row.transactionId)).toEqual(['shop-sale']);
    expect(contactWhere(business.prisma)).toMatchObject({ category: 'BUSINESS' });

    const loans = setup();
    expect(await loans.service.getOverdue('biz-1', 'RECEIVABLE', 'LOAN')).toEqual([]);
    expect(contactWhere(loans.prisma)).toEqual({ businessId: 'biz-1', category: 'LOAN' });
  });
});

describe('ReceivablesPayablesService.getDueSoon', () => {
  it('lists what falls due this week, narrowed to the named kind', async () => {
    const all = setup();
    expect((await all.service.getDueSoon('biz-1', 'RECEIVABLE')).map((row) => [row.transactionId, row.daysUntilDue])).toEqual([
      ['trader-sale', 2],
      ['lender-loan', 4],
    ]);
    expect(contactWhere(all.prisma)).toEqual({ businessId: 'biz-1', type: { in: ['CUSTOMER', 'BOTH'] } });

    const business = setup();
    expect((await business.service.getDueSoon('biz-1', 'RECEIVABLE', 7, 'BUSINESS')).map((row) => row.transactionId)).toEqual(['trader-sale']);

    const loans = setup();
    expect((await loans.service.getDueSoon('biz-1', 'RECEIVABLE', 3, 'LOAN')).map((row) => row.transactionId)).toEqual([]);
    expect((await loans.service.getDueSoon('biz-1', 'RECEIVABLE', 4, 'LOAN')).map((row) => row.transactionId)).toEqual(['lender-loan']);
    expect(contactWhere(loans.prisma)).toEqual({ businessId: 'biz-1', category: 'LOAN' });
  });
});

describe('ReceivablesPayablesController category', () => {
  it('hands the category, or its absence, to aging, overdue and due-soon', () => {
    const service = { getAging: vi.fn(), getOverdue: vi.fn(), getDueSoon: vi.fn() };
    const controller = new ReceivablesPayablesController(service as never);

    controller.receivablesAging('biz-1', { category: 'BUSINESS' });
    controller.payablesAging('biz-1', {});
    controller.receivablesOverdue('biz-1', {});
    controller.payablesOverdue('biz-1', { category: 'LOAN' });
    controller.receivablesDueSoon('biz-1', { days: 14, category: 'LOAN' });
    controller.payablesDueSoon('biz-1', {});

    expect(service.getAging.mock.calls).toEqual([
      ['biz-1', 'RECEIVABLE', 'BUSINESS'],
      ['biz-1', 'PAYABLE', undefined],
    ]);
    expect(service.getOverdue.mock.calls).toEqual([
      ['biz-1', 'RECEIVABLE', undefined],
      ['biz-1', 'PAYABLE', 'LOAN'],
    ]);
    expect(service.getDueSoon.mock.calls).toEqual([
      ['biz-1', 'RECEIVABLE', 14, 'LOAN'],
      ['biz-1', 'PAYABLE', undefined, undefined],
    ]);
  });
});

describe('ContactCategoryQueryDto and DueSoonQueryDto', () => {
  // The global pipe, as main.ts sets it up.
  const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
  const parse = (metatype: typeof ContactCategoryQueryDto | typeof DueSoonQueryDto, query: Record<string, unknown>) =>
    pipe.transform(query, { type: 'query', metatype });
  // The pipe's messages for a refused query.
  const refusal = async (metatype: typeof ContactCategoryQueryDto | typeof DueSoonQueryDto, query: Record<string, unknown>) => {
    const error = await parse(metatype, query).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(BadRequestException);
    return ((error as BadRequestException).getResponse() as { message: string[] }).message;
  };

  it('takes either category, or none', async () => {
    for (const dto of [ContactCategoryQueryDto, DueSoonQueryDto]) {
      await expect(parse(dto, {})).resolves.toEqual({});
      await expect(parse(dto, { category: 'BUSINESS' })).resolves.toEqual({ category: 'BUSINESS' });
      await expect(parse(dto, { category: 'LOAN' })).resolves.toEqual({ category: 'LOAN' });
    }
    await expect(parse(DueSoonQueryDto, { category: 'LOAN', days: '14' })).resolves.toEqual({ category: 'LOAN', days: 14 });
  });

  it('refuses another value, a null, and anything it does not know', async () => {
    for (const dto of [ContactCategoryQueryDto, DueSoonQueryDto]) {
      expect(await refusal(dto, { category: 'business' })).toEqual(['category must be one of the following values: BUSINESS, LOAN']);
      expect(await refusal(dto, { category: 'PERSONAL' })).toEqual(['category must be one of the following values: BUSINESS, LOAN']);
      expect(await refusal(dto, { category: null })).toEqual(['category must be one of the following values: BUSINESS, LOAN']);
      expect(await refusal(dto, { kind: 'LOAN' })).toEqual(['property kind should not exist']);
    }
    expect(await refusal(DueSoonQueryDto, { days: '91' })).toEqual(['days must not be greater than 90']);
  });
});

describe('ReceivablesPayablesService loans with any kind of loan contact', () => {
  const recording = () => {
    const createTransaction = vi.fn((_businessId: string, dto: unknown) => Promise.resolve(dto));
    const prisma = {
      $transaction: vi.fn((work: (client: unknown) => unknown) => work(prisma)),
      contact: {
        findUnique: vi.fn(({ where }: { where: { id: string } }) => Promise.resolve(contacts.find((row) => row.id === where.id) ?? null)),
      },
      account: {
        findFirst: vi.fn(({ where }: { where: { businessId: string; accountSubtype: string } }) =>
          Promise.resolve(where.businessId === 'biz-1' ? { id: where.accountSubtype === 'receivable' ? 'ar' : 'ap', businessId: 'biz-1' } : null),
        ),
        findUnique: vi.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(where.id === 'cash' ? { id: 'cash', businessId: 'biz-1', accountType: 'ASSET', accountSubtype: 'cash' } : null),
        ),
      },
    };
    return { service: new ReceivablesPayablesService(prisma as never, { createTransaction } as never), createTransaction };
  };
  const loan = { amount: '2500', date: TODAY, moneyAccountId: 'cash' };

  it('takes a loan from a Bank: Dr the money account / Cr Payable', async () => {
    const { service, createTransaction } = recording();
    await service.recordPurchase('biz-1', { ...loan, contactId: 'bank' } as never, 'user-1');
    expect(createTransaction.mock.calls[0][1]).toMatchObject({
      transactionType: 'PURCHASE',
      contactId: 'bank',
      entries: [
        { accountId: 'cash', entryType: 'DEBIT', amount: '2500' },
        { accountId: 'ap', entryType: 'CREDIT', amount: '2500' },
      ],
    });
  });

  it('gives a loan to a Bank: Dr Receivable / Cr the money account', async () => {
    const { service, createTransaction } = recording();
    await service.recordSale('biz-1', { ...loan, contactId: 'bank' } as never, 'user-1');
    expect(createTransaction.mock.calls[0][1]).toMatchObject({
      transactionType: 'SALE',
      contactId: 'bank',
      entries: [
        { accountId: 'ar', entryType: 'DEBIT', amount: '2500' },
        { accountId: 'cash', entryType: 'CREDIT', amount: '2500' },
      ],
    });
  });

  it('keeps the Customer/Supplier rule for trade contacts', async () => {
    const { service, createTransaction } = recording();
    await expect(service.recordSale('biz-1', { amount: '10', date: TODAY, contactId: 'supplier' } as never, 'user-1')).rejects.toThrow(BadRequestException);
    await expect(service.recordPurchase('biz-1', { amount: '10', date: TODAY, contactId: 'shop' } as never, 'user-1')).rejects.toThrow(BadRequestException);
    expect(createTransaction).not.toHaveBeenCalled();
  });
});
