import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { contactStatement, type ContactStatementPage, type StatementPosting } from './contact-statement.js';
import { ContactStatementQueryDto } from './dto/contact-statement-query.dto.js';
import { ReceivablesPayablesService } from './receivables-payables.service.js';

type Entry = StatementPosting['entries'][number];

const entry = (subtype: string | null, entryType: 'DEBIT' | 'CREDIT', amount: string, name = subtype ?? 'Cash'): Entry => ({ entryType, amount, account: { name, accountSubtype: subtype } });
const posting = (id: string, type: StatementPosting['transactionType'], day: string, entries: Entry[], over: Partial<StatementPosting> = {}): StatementPosting => ({
  id,
  transactionType: type,
  transactionDate: new Date(`${day}T00:00:00.000Z`),
  createdAt: new Date(`${day}T08:00:00.000Z`),
  referenceNo: null,
  description: null,
  status: 'POSTED',
  reversalOfId: null,
  entries,
  ...over,
});
const sale = (id: string, day: string, amount: string, over: Partial<StatementPosting> = {}) => posting(id, 'SALE', day, [entry('receivable', 'DEBIT', amount), entry(null, 'CREDIT', amount, 'Sales')], over);
const purchase = (id: string, day: string, amount: string) => posting(id, 'PURCHASE', day, [entry(null, 'DEBIT', amount, 'Stock'), entry('payable', 'CREDIT', amount)]);
const received = (id: string, day: string, amount: string, over: Partial<StatementPosting> = {}) => posting(id, 'PAYMENT', day, [entry('bank', 'DEBIT', amount, 'Islami Bank'), entry('receivable', 'CREDIT', amount)], over);
const paid = (id: string, day: string, amount: string) => posting(id, 'PAYMENT', day, [entry('payable', 'DEBIT', amount), entry('cash', 'CREDIT', amount, 'Cash')]);

// kind:amount:running, ":x" when cancelled -- the browser test's shorthand.
const summary = (page: Pick<ContactStatementPage, 'entries'>) => page.entries.map((row) => `${row.kind}:${row.amount}:${row.runningBalance}${row.cancelled ? ':x' : ''}`);

describe('contactStatement', () => {
  it("reads exactly as the browser's statement did", () => {
    // booksDisplay.test.ts's postings, newest first as the API sent them.
    const postings = [
      received('pay', '2026-09-02', '35000', { description: 'Clears INV-0277' }),
      sale('s2', '2026-07-20', '15000', { referenceNo: 'INV-0318' }),
      sale('s1', '2026-06-03', '35000', { referenceNo: 'INV-0277' }),
      sale('void', '2026-08-01', '999', { status: 'VOIDED' }),
      purchase('buy', '2026-09-10', '5000'),
      paid('out', '2026-09-12', '5000'),
      posting('journal', 'JOURNAL', '2026-09-13', []),
    ];
    const statement = contactStatement({ openingBalance: '0', prior: [], period: postings, page: 1, limit: 50 });
    expect(summary(statement)).toEqual(['sale:35000.00:35000.00', 'sale:15000.00:50000.00', 'sale:999.00:50000.00:x', 'received:35000.00:15000.00', 'purchase:5000.00:10000.00', 'paid:5000.00:15000.00']);
    expect(statement.entries[3].wallet).toBe('Islami Bank');
    expect(statement.entries[0]).toMatchObject({ referenceNo: 'INV-0277', wallet: null });
    expect(statement.lastSale?.transactionId).toBe('buy');
    expect(statement.lastPayment?.transactionId).toBe('out');
    expect(statement.closingBalance).toBe('15000.00');
    expect(statement.meta).toEqual({ page: 1, limit: 50, total: 6, totalPages: 1 });

    const empty = contactStatement({ openingBalance: '-1200', prior: [], period: [], page: 1, limit: 50 });
    expect(empty).toMatchObject({ entries: [], balanceBroughtForward: '-1200.00', closingBalance: '-1200.00', pageOpeningBalance: '-1200.00', pageClosingBalance: '-1200.00', lastSale: null, lastPayment: null });
    expect(empty.meta).toEqual({ page: 1, limit: 50, total: 0, totalPages: 0 });
  });

  it('carries the running balance from one page to the next', () => {
    const postings = [
      sale('s1', '2026-01-05', '1000'),
      received('r1', '2026-01-10', '300'),
      sale('s2', '2026-02-01', '200'),
      purchase('p1', '2026-02-03', '400'),
      paid('o1', '2026-02-04', '100'),
      sale('s3', '2026-03-01', '50'),
      received('r2', '2026-03-02', '150'),
    ].reverse();
    const page = (n: number) => contactStatement({ openingBalance: '500', prior: [], period: postings, page: n, limit: 3 });
    const [one, two, three, four] = [page(1), page(2), page(3), page(4)];

    expect(summary(one)).toEqual(['sale:1000.00:1500.00', 'received:300.00:1200.00', 'sale:200.00:1400.00']);
    expect(summary(two)).toEqual(['purchase:400.00:1000.00', 'paid:100.00:1100.00', 'sale:50.00:1150.00']);
    expect(summary(three)).toEqual(['received:150.00:1000.00']);
    expect([one.pageOpeningBalance, one.pageClosingBalance]).toEqual(['500.00', '1400.00']);
    expect(two.pageOpeningBalance).toBe(one.pageClosingBalance);
    expect(three.pageOpeningBalance).toBe(two.pageClosingBalance);
    expect(three.pageClosingBalance).toBe('1000.00');
    // The period's figures don't depend on the page.
    for (const p of [one, two, three, four]) {
      expect(p).toMatchObject({ closingBalance: '1000.00', balanceBroughtForward: '500.00', meta: { limit: 3, total: 7, totalPages: 3 } });
      expect(p.lastSale?.transactionId).toBe('s3');
      expect(p.lastPayment?.transactionId).toBe('r2');
    }
    // Past the last page: nothing, opening and closing where the period ends.
    expect(four).toMatchObject({ entries: [], pageOpeningBalance: '1000.00', pageClosingBalance: '1000.00' });
    // The pages together are the one long statement.
    const whole = contactStatement({ openingBalance: '500', prior: [], period: postings, page: 1, limit: 200 });
    expect([...one.entries, ...two.entries, ...three.entries]).toEqual(whole.entries);
  });

  it('shows a voided payment and its reversal without counting either', () => {
    const postings = [
      sale('s1', '2026-05-01', '1000'),
      received('r1', '2026-05-03', '400', { status: 'VOIDED' }),
      // The reversal: same type, lines mirrored, dated the day of the void.
      posting('r1-rev', 'PAYMENT', '2026-05-09', [entry('bank', 'CREDIT', '400', 'Islami Bank'), entry('receivable', 'DEBIT', '400')], { reversalOfId: 'r1' }),
      received('r2', '2026-05-10', '250'),
    ];
    const statement = contactStatement({ openingBalance: '0', prior: [], period: postings, page: 1, limit: 50 });
    // The reversal reads as money out, as its lines say; neither moves the balance.
    expect(summary(statement)).toEqual(['sale:1000.00:1000.00', 'received:400.00:1000.00:x', 'paid:400.00:1000.00:x', 'received:250.00:750.00']);
    expect(statement.closingBalance).toBe('750.00');
    expect(statement.lastPayment?.transactionId).toBe('r2');

    const onlyVoided = contactStatement({ openingBalance: '0', prior: [], period: postings.slice(0, 3), page: 1, limit: 50 });
    expect(onlyVoided.lastPayment).toBeNull();
    expect(onlyVoided.closingBalance).toBe('1000.00');
  });

  it('orders postings on one day by when they were made, then by id', () => {
    const day = '2026-04-01';
    const madeAt = (time: string) => ({ createdAt: new Date(`${day}T${time}.000Z`) });
    const a = sale('a', day, '10', madeAt('08:00:00'));
    const b = sale('b', day, '20', madeAt('09:00:00'));
    // Made at the same moment: only the id tells them apart.
    const c = received('c', day, '4', madeAt('10:00:00'));
    const d = received('d', day, '6', madeAt('10:00:00'));
    const expected = ['sale:10.00:10.00', 'sale:20.00:30.00', 'received:4.00:26.00', 'received:6.00:20.00'];

    // Whatever order they arrive in.
    for (const period of [[b, a, d, c], [d, c, b, a], [c, a, d, b]]) {
      expect(summary(contactStatement({ openingBalance: '0', prior: [], period, page: 1, limit: 50 }))).toEqual(expected);
    }
    // A page boundary between two same-day rows holds.
    const pages = [1, 2, 3, 4].map((n) => contactStatement({ openingBalance: '0', prior: [], period: [d, b, c, a], page: n, limit: 1 }));
    expect(pages.flatMap(summary)).toEqual(expected);
    expect(pages[1].pageOpeningBalance).toBe(pages[0].pageClosingBalance);
    expect(pages[3].pageOpeningBalance).toBe('26.00');
  });

  it('leaves out a payment that touches neither the receivable nor the payable', () => {
    const period = [
      sale('s1', '2026-04-01', '100'),
      received('r1', '2026-04-03', '30'),
      // Money moved between two wallets, with the contact on it.
      posting('move', 'PAYMENT', '2026-04-05', [entry('cash', 'DEBIT', '5', 'Cash'), entry('bank', 'CREDIT', '5', 'Islami Bank')]),
    ];
    const statement = contactStatement({ openingBalance: '0', prior: [], period, page: 1, limit: 50 });
    expect(statement.entries.map((row) => row.transactionId)).toEqual(['s1', 'r1']);
    expect(summary(statement)).toEqual(['sale:100.00:100.00', 'received:30.00:70.00']);
    expect(statement).toMatchObject({ closingBalance: '70.00', pageClosingBalance: '70.00', meta: { total: 2, totalPages: 1 } });
    expect(statement.lastPayment?.transactionId).toBe('r1');
  });

  it('counts the receivable or payable line, as the headline balance does', () => {
    const period = [
      // Part paid at the till: they owe the 400.
      posting('split-sale', 'SALE', '2026-04-01', [entry('cash', 'DEBIT', '600', 'Cash'), entry('receivable', 'DEBIT', '400'), entry(null, 'CREDIT', '1000', 'Sales')]),
      // Part paid out: the business owes the 700.
      posting('split-buy', 'PURCHASE', '2026-04-02', [entry(null, 'DEBIT', '1000', 'Stock'), entry('cash', 'CREDIT', '300', 'Cash'), entry('payable', 'CREDIT', '700')]),
      // Paid in full on the spot, or booked against the wrong side: what
      // they owe never moved, so neither is on their statement.
      posting('cash-sale', 'SALE', '2026-04-03', [entry('cash', 'DEBIT', '70', 'Cash'), entry(null, 'CREDIT', '70', 'Sales')]),
      posting('cash-buy', 'PURCHASE', '2026-04-04', [entry(null, 'DEBIT', '50', 'Stock'), entry('cash', 'CREDIT', '50', 'Cash')]),
      posting('odd-sale', 'SALE', '2026-04-05', [entry('payable', 'DEBIT', '25'), entry(null, 'CREDIT', '25', 'Sales')]),
    ];
    const statement = contactStatement({ openingBalance: '0', prior: [], period, page: 1, limit: 50 });
    expect(summary(statement)).toEqual(['sale:400.00:400.00', 'purchase:700.00:-300.00']);
    // opening + receivable 400 - payable 700: computeDirection()'s figure.
    expect(statement).toMatchObject({ closingBalance: '-300.00', meta: { total: 2 } });
    expect(statement.lastSale?.transactionId).toBe('split-buy');
  });

  it('brings forward what was counted before dateFrom', () => {
    // They were owed 200 at the start (Dena).
    const prior = [sale('s0', '2026-01-10', '1000'), sale('v0', '2026-01-20', '5000', { status: 'VOIDED' }), purchase('p0', '2026-01-25', '300')];
    const period = [
      // v0's reversal falls in the period; like v0 it counts for nothing.
      posting('v0-rev', 'SALE', '2026-02-05', [entry('receivable', 'CREDIT', '5000'), entry(null, 'DEBIT', '5000', 'Sales')], { reversalOfId: 'v0' }),
      received('r1', '2026-02-10', '500'),
    ];
    const statement = contactStatement({ openingBalance: '-200', prior, period, page: 1, limit: 50 });
    expect(statement).toMatchObject({ openingBalance: '-200.00', balanceBroughtForward: '500.00', pageOpeningBalance: '500.00', closingBalance: '0.00', pageClosingBalance: '0.00' });
    expect(summary(statement)).toEqual(['sale:5000.00:500.00:x', 'received:500.00:0.00']);
    expect(statement.meta.total).toBe(2);
    // No sale in the period: the newest before it.
    expect(statement.lastSale).toMatchObject({ transactionId: 'p0', kind: 'purchase', runningBalance: '500.00' });
  });
});

describe('ReceivablesPayablesService.getContactStatement', () => {
  const contact = { id: 'rahim', businessId: 'biz-1', name: 'Rahim Traders', openingBalance: new Prisma.Decimal('-200') };
  const postings = [
    sale('s0', '2026-01-10', '1000'),
    sale('v0', '2026-01-20', '5000', { status: 'VOIDED' }),
    purchase('p0', '2026-01-25', '300'),
    posting('v0-rev', 'SALE', '2026-02-05', [entry('receivable', 'CREDIT', '5000'), entry(null, 'DEBIT', '5000', 'Sales')], { reversalOfId: 'v0' }),
    received('r1', '2026-02-10', '500'),
  ];
  type DateFilter = { lt?: Date; gte?: Date; lte?: Date };
  const inWindow = (date: Date, filter?: DateFilter) => !filter || ((!filter.lt || date < filter.lt) && (!filter.gte || date >= filter.gte) && (!filter.lte || date <= filter.lte));

  const setup = (found: typeof contact | null = contact) => {
    const prisma = {
      contact: { findUnique: vi.fn().mockResolvedValue(found) },
      transaction: {
        findMany: vi.fn(({ where }: { where: { transactionDate?: DateFilter } }) => Promise.resolve(postings.filter((p) => inWindow(p.transactionDate, where.transactionDate)))),
      },
    };
    return { service: new ReceivablesPayablesService(prisma as never, {} as never), prisma };
  };

  it('reads the period and, with a dateFrom, what came before it', async () => {
    const { service, prisma } = setup();
    const statement = await service.getContactStatement('biz-1', 'rahim', { dateFrom: '2026-02-01' });
    expect(statement).toMatchObject({ contactId: 'rahim', contactName: 'Rahim Traders', balanceBroughtForward: '500.00', closingBalance: '0.00' });
    expect(statement.entries.map((row) => row.transactionId)).toEqual(['v0-rev', 'r1']);

    const [before, during] = prisma.transaction.findMany.mock.calls.map(([args]) => args.where);
    expect(before).toMatchObject({ businessId: 'biz-1', contactId: 'rahim', transactionType: { in: ['SALE', 'PURCHASE', 'PAYMENT'] }, transactionDate: { lt: new Date('2026-02-01') } });
    expect(during).toMatchObject({ businessId: 'biz-1', contactId: 'rahim', transactionDate: { gte: new Date('2026-02-01') } });
  });

  it('starts from the opening balance without a dateFrom, and stops at dateTo', async () => {
    const { service, prisma } = setup();
    const statement = await service.getContactStatement('biz-1', 'rahim', { dateTo: '2026-01-31' });
    expect(prisma.transaction.findMany).toHaveBeenCalledTimes(1);
    expect(statement).toMatchObject({ balanceBroughtForward: '-200.00', closingBalance: '500.00', meta: { page: 1, limit: 50, total: 3, totalPages: 1 } });
  });

  it("is a 404 for an unknown contact or another workspace's", async () => {
    await expect(setup(null).service.getContactStatement('biz-1', 'nobody')).rejects.toThrow(NotFoundException);
    const { service, prisma } = setup({ ...contact, businessId: 'biz-2' });
    await expect(service.getContactStatement('biz-1', 'rahim')).rejects.toThrow(NotFoundException);
    expect(prisma.transaction.findMany).not.toHaveBeenCalled();
  });

  it('refuses a dateFrom after the dateTo', async () => {
    await expect(setup().service.getContactStatement('biz-1', 'rahim', { dateFrom: '2026-03-01', dateTo: '2026-02-01' })).rejects.toThrow(BadRequestException);
  });
});

describe('ContactStatementQueryDto', () => {
  const errorsFor = async (query: Record<string, unknown>) => (await validate(plainToInstance(ContactStatementQueryDto, query))).map((error) => error.property);

  it('takes calendar days and a page size up to 200', async () => {
    expect(await errorsFor({})).toEqual([]);
    expect(await errorsFor({ dateFrom: '2026-02-01', dateTo: '2026-02-28', page: '2', limit: '200' })).toEqual([]);
    expect(plainToInstance(ContactStatementQueryDto, { page: '2', limit: '25' })).toMatchObject({ page: 2, limit: 25 });
  });

  it('refuses other date forms, impossible days, a null and pages out of range', async () => {
    expect(await errorsFor({ dateFrom: '2026-W10', dateTo: '2026-02-30' })).toEqual(['dateFrom', 'dateTo']);
    expect(await errorsFor({ dateFrom: null })).toEqual(['dateFrom']);
    expect(await errorsFor({ page: '0', limit: '201' })).toEqual(['page', 'limit']);
    expect(await errorsFor({ limit: '1.5' })).toEqual(['limit']);
  });
});
