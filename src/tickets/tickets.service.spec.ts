import { NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListTicketsQueryDto } from './dto/list-tickets-query.dto.js';
import { TicketsService } from './tickets.service.js';

type Message = { senderType: 'USER' | 'ADMIN'; createdAt: Date };
type Ticket = {
  id: string;
  platformUserId: string;
  subject: string;
  category: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  status: 'OPEN' | 'IN_PROGRESS' | 'WAITING_ON_USER' | 'RESOLVED' | 'CLOSED';
  assignedToAdminId: string | null;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
  messages: Message[];
};
type Row = Record<string, unknown>;
type MessagesArgs = { where?: Row; orderBy?: { createdAt: 'asc' | 'desc' }; take?: number; select?: Row };
type FindArgs = { where?: Row; select?: Row; include?: Row; skip?: number; take?: number; orderBy?: unknown };

const HOUR = 60 * 60 * 1000;
const NOW = Date.now();
// When something happened, in hours before now.
const ago = (hours: number) => new Date(NOW - hours * HOUR);
const asked = (hoursAgo: number): Message => ({ senderType: 'USER', createdAt: ago(hoursAgo) });
const answered = (hoursAgo: number): Message => ({ senderType: 'ADMIN', createdAt: ago(hoursAgo) });

const ticket = (id: string, over: Partial<Ticket> = {}): Ticket => {
  const createdAt = over.createdAt ?? ago(48);
  return {
    id,
    platformUserId: 'cust-rahim',
    subject: `About ${id}`,
    category: 'TECHNICAL',
    priority: 'MEDIUM',
    status: 'OPEN',
    assignedToAdminId: null,
    createdAt,
    updatedAt: createdAt,
    resolvedAt: null,
    messages: [],
    ...over,
  };
};

const CUSTOMER = {
  id: 'cust-rahim',
  name: 'Rahim Uddin',
  email: 'rahim@example.com',
  role: 'USER',
  ownedBusinesses: [{ plan: { id: 'plan-pro', name: 'Monthly Pro' } }],
};
const ADMIN = { id: 'admin-nadia', name: 'Nadia Akter', email: 'nadia@example.com', role: 'SUPPORT_ADMIN', ownedBusinesses: [] };
const LEGACY = { id: 'legacy-karim', name: 'Karim Mia', email: 'karim@example.com', plan: null };

// The slice of Prisma's filters the tickets service sends; any other
// operator fails the test rather than silently matching.
const same = (a: unknown, b: unknown) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b);
const fits = (value: unknown, filter: unknown): boolean => {
  if (filter === null || typeof filter !== 'object' || filter instanceof Date) return same(value, filter);
  return Object.entries(filter).every(([op, operand]) => {
    if (op === 'in') return (operand as unknown[]).some((v) => same(value, v));
    if (op === 'notIn') return !(operand as unknown[]).some((v) => same(value, v));
    if (op === 'not') return !same(value, operand);
    if (op === 'lt') return value instanceof Date && value < (operand as Date);
    if (op === 'gte') return value instanceof Date && value >= (operand as Date);
    // search: `mode` only qualifies `contains`.
    if (op === 'mode') return true;
    if (op === 'contains')
      return (
        typeof value === 'string' &&
        ((filter as Row).mode === 'insensitive' ? value.toLowerCase().includes(String(operand).toLowerCase()) : value.includes(String(operand)))
      );
    throw new Error(`The fake can't filter by ${op}`);
  });
};
const matches = (row: Row, where: Row = {}): boolean =>
  Object.entries(where).every(([key, filter]) => {
    if (key === 'AND') return [filter].flat().every((part) => matches(row, part as Row));
    if (key === 'OR') return (filter as Row[]).some((part) => matches(row, part));
    return fits(row[key], filter);
  });

const pick = (row: Row, select: Row) => Object.fromEntries(Object.keys(select).flatMap((key) => (select[key] ? [[key, row[key]]] : [])));

const messagesOf = (t: Ticket, args: MessagesArgs) => {
  const sign = args.orderBy?.createdAt === 'desc' ? -1 : 1;
  const list = t.messages.filter((m) => matches(m, args.where)).sort((a, b) => sign * (a.createdAt.getTime() - b.createdAt.getTime()));
  return list.slice(0, args.take ?? list.length).map((m) => (args.select ? pick(m, args.select) : m));
};

const shape = (t: Ticket, { select, include }: FindArgs) => {
  const { messages: _messages, ...row } = t;
  const relation = (select ?? include)?.messages as MessagesArgs | undefined;
  return { ...(select ? pick(row, select) : row), ...(relation && { messages: messagesOf(t, relation) }) };
};

const fakePrisma = (tickets: Ticket[]) => {
  const users = [CUSTOMER, ADMIN];
  const chosen = <T extends Row>(rows: T[], args: FindArgs) =>
    rows.filter((row) => matches(row, args.where)).map((row) => (args.select ? pick(row, args.select) : row));
  return {
    supportTicket: {
      findMany: vi.fn(async (args: FindArgs = {}) => {
        const skip = args.skip ?? 0;
        const found = tickets.filter((t) => matches(t, args.where));
        return found.slice(skip, args.take === undefined ? undefined : skip + args.take).map((t) => shape(t, args));
      }),
      findUnique: vi.fn(async (args: FindArgs) => {
        const found = tickets.find((t) => matches(t, args.where));
        return found ? shape(found, args) : null;
      }),
      count: vi.fn(async (args: FindArgs = {}) => tickets.filter((t) => matches(t, args.where)).length),
      groupBy: vi.fn(async ({ by: [field] }: { by: (keyof Ticket)[] }) => {
        const counts = new Map<unknown, number>();
        for (const t of tickets) counts.set(t[field], (counts.get(t[field]) ?? 0) + 1);
        return [...counts].map(([value, count]) => ({ [field]: value, _count: count }));
      }),
    },
    // Nothing in the list reads messages on their own; a call fails here.
    ticketMessage: {},
    user: {
      findMany: vi.fn(async (args: FindArgs) => chosen(users, args)),
      findUnique: vi.fn(async (args: FindArgs) => chosen(users, args)[0] ?? null),
    },
    platformUser: { findMany: vi.fn(async (args: FindArgs) => chosen([LEGACY], args)) },
  };
};

const setup = (tickets: Ticket[]) => {
  const prisma = fakePrisma(tickets);
  return { service: new TicketsService(prisma as never, {} as never, {} as never), prisma };
};
const ids = (result: { data: { id: string }[] }) => result.data.map((row) => row.id);

// Who wrote last on each, and so whether the team owes them a reply.
const QUEUE = [
  ticket('asked', { messages: [asked(30)] }),
  ticket('answered', { status: 'IN_PROGRESS', messages: [asked(30), answered(20)] }),
  // Owed whatever the status says.
  ticket('wrote-back', { status: 'WAITING_ON_USER', messages: [asked(10), answered(8), asked(2)] }),
  ticket('solved', { status: 'RESOLVED', resolvedAt: ago(1), messages: [asked(5)] }),
  // Opened without a message: owed since it opened.
  ticket('empty', { createdAt: ago(3) }),
  ticket('closed-empty', { status: 'CLOSED' }),
  ticket('again', { status: 'IN_PROGRESS', assignedToAdminId: 'admin-nadia', createdAt: ago(50), messages: [asked(50), answered(40), asked(26)] }),
];

describe('TicketsService.list', () => {
  it("keeps today's query and order when no sort is asked for", async () => {
    const { service, prisma } = setup(QUEUE);
    const result = await service.list({ page: 2, limit: 5 });

    expect(prisma.supportTicket.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.supportTicket.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: [{ assignedToAdminId: { sort: 'asc', nulls: 'first' } }, { priority: 'desc' }, { createdAt: 'desc' }],
      skip: 5,
      take: 5,
      include: { messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { senderType: true, createdAt: true } } },
    });
    expect(result.meta).toEqual({ page: 2, limit: 5, total: 7, totalPage: 2 });

    // sort=queue names that order, for a sort menu to send.
    const named = setup(QUEUE);
    const queued = await named.service.list({ sort: 'queue', page: 2, limit: 5 });
    expect(named.prisma.supportTicket.findMany).toHaveBeenCalledTimes(1);
    expect(named.prisma.supportTicket.findMany.mock.calls[0]).toEqual(prisma.supportTicket.findMany.mock.calls[0]);
    expect(queued).toEqual(result);
  });

  it("assignedToAdminId=none lists the tickets nobody is assigned to; an admin's id still lists theirs", async () => {
    const { service, prisma } = setup(QUEUE);

    const unassigned = await service.list({ assignedToAdminId: 'none' });
    expect(prisma.supportTicket.count).toHaveBeenLastCalledWith({ where: { assignedToAdminId: null } });
    expect(unassigned.meta.total).toBe(6);
    expect(ids(unassigned)).not.toContain('again');

    const nadias = await service.list({ assignedToAdminId: 'admin-nadia' });
    expect(ids(nadias)).toEqual(['again']);
    expect(nadias.data[0].assignedAdmin).toEqual({ id: 'admin-nadia', name: 'Nadia Akter' });

    // Open and unassigned: the stats' unassignedOpenCount.
    const { unassignedOpenCount } = await service.stats();
    expect((await service.list({ status: 'OPEN', assignedToAdminId: 'none' })).meta.total).toBe(unassignedOpenCount);
  });

  it('awaitingReply=true lists exactly the tickets the stats count as needing a reply', async () => {
    const { service } = setup(QUEUE);
    const stats = await service.stats();
    const result = await service.list({ awaitingReply: true });

    expect(stats).toMatchObject({ needsReplyCount: 4, needsReplyOver24hCount: 2 });
    expect(result.meta.total).toBe(stats.needsReplyCount);
    expect(ids(result).sort()).toEqual(['again', 'asked', 'empty', 'wrote-back']);
    // The rows say so the way they always have.
    expect(result.data.find((row) => row.id === 'empty')).toMatchObject({ lastMessageFrom: null, lastMessageAt: null });
    expect(result.data.find((row) => row.id === 'wrote-back')).toMatchObject({ lastMessageFrom: 'USER', lastMessageAt: ago(2) });

    // A page of them still counts them all.
    const second = await service.list({ awaitingReply: true, page: 2, limit: 3 });
    expect(second.meta).toEqual({ page: 2, limit: 3, total: 4, totalPage: 2 });
    expect(second.data).toHaveLength(1);
  });

  it('awaitingReply narrows the status and assignee filters instead of replacing them', async () => {
    const { service } = setup(QUEUE);
    expect(ids(await service.list({ awaitingReply: true, status: 'IN_PROGRESS' }))).toEqual(['again']);
    expect(ids(await service.list({ awaitingReply: true, status: 'IN_QUEUE', assignedToAdminId: 'none' })).sort()).toEqual(['asked', 'empty', 'wrote-back']);
    expect((await service.list({ awaitingReply: true, status: 'DONE' })).meta.total).toBe(0);
    // And the search: "About answered" matches it but is not owed a reply.
    expect(ids(await service.list({ awaitingReply: true, search: 'about a' })).sort()).toEqual(['again', 'asked']);
  });

  it('filters nothing when awaitingReply is false or left out', async () => {
    const { service } = setup(QUEUE);
    expect((await service.list({ awaitingReply: false })).meta.total).toBe(QUEUE.length);
    expect((await service.list({})).meta.total).toBe(QUEUE.length);
  });
});

describe('TicketsService.list sort=waiting', () => {
  const WAITING = [
    ticket('low-oldest', { priority: 'LOW', createdAt: ago(90), messages: [asked(90)] }),
    ticket('urgent-new', { priority: 'URGENT', createdAt: ago(1), messages: [asked(1)] }),
    // The team answered since: it no longer owes a reply, so it follows
    // every ticket that does, however urgent.
    ticket('urgent-answered', { priority: 'URGENT', createdAt: ago(6), messages: [asked(6), answered(0.5)] }),
    ticket('high', { priority: 'HIGH', createdAt: ago(2), messages: [asked(2)] }),
    // Never wrote: waiting since the ticket opened.
    ticket('medium-silent', { createdAt: ago(12) }),
    // Wrote twice: the newer message counts.
    ticket('medium-twice', { createdAt: ago(40), messages: [asked(40), asked(8)] }),
  ];
  const RANKED = ['urgent-new', 'high', 'medium-silent', 'medium-twice', 'low-oldest', 'urgent-answered'];

  it('puts the tickets owing a reply first, the most urgent first, then whoever has waited longest since their newest message', async () => {
    const { service } = setup(WAITING);
    const result = await service.list({ sort: 'waiting', limit: 100 });

    expect(ids(result)).toEqual(RANKED);
    expect(result.meta).toEqual({ page: 1, limit: 100, total: 6, totalPage: 1 });
    // The list's usual rows.
    expect(result.data[0]).toMatchObject({ id: 'urgent-new', lastMessageFrom: 'USER', platformUser: { id: 'cust-rahim', name: 'Rahim Uddin' } });
    expect(result.data[5]).toMatchObject({ lastMessageFrom: 'ADMIN', lastMessageAt: ago(0.5), assignedAdmin: null });
  });

  it("puts an answered ticket behind one still waiting on the team, as the In queue tab sorts without 'Waiting on us'", async () => {
    const { service } = setup([
      // Asked 5 days ago, answered 4 days ago: the customer's turn.
      ticket('answered-long-ago', { priority: 'HIGH', status: 'WAITING_ON_USER', createdAt: ago(120), messages: [asked(120), answered(96)] }),
      ticket('asked-an-hour-ago', { priority: 'HIGH', createdAt: ago(1), messages: [asked(1)] }),
      // The customer wrote last, but it is solved: nothing is owed.
      ticket('solved-urgent', { priority: 'URGENT', status: 'RESOLVED', resolvedAt: ago(1), createdAt: ago(10), messages: [asked(10)] }),
      // Answered, and urgent: first among the ones not owed.
      ticket('answered-urgent', { priority: 'URGENT', status: 'IN_PROGRESS', createdAt: ago(5), messages: [asked(5), answered(3)] }),
      // The customer wrote back after the reply: owed again, since 2h ago.
      ticket('wrote-back', { priority: 'LOW', status: 'WAITING_ON_USER', createdAt: ago(30), messages: [asked(30), answered(20), asked(2)] }),
    ]);

    const inQueue = await service.list({ sort: 'waiting', status: 'IN_QUEUE' });
    expect(ids(inQueue)).toEqual(['asked-an-hour-ago', 'wrote-back', 'answered-urgent', 'answered-long-ago']);

    // Among the ones not owed: the most urgent, then the oldest activity.
    expect(ids(await service.list({ sort: 'waiting' }))).toEqual(['asked-an-hour-ago', 'wrote-back', 'solved-urgent', 'answered-urgent', 'answered-long-ago']);
  });

  it('cuts every page from the same ranking, and loads only that page in full', async () => {
    const { service, prisma } = setup(WAITING);
    const pages = [];
    for (const page of [1, 2, 3, 4]) pages.push(await service.list({ sort: 'waiting', page, limit: 2 }));

    expect(pages.map(ids)).toEqual([RANKED.slice(0, 2), RANKED.slice(2, 4), RANKED.slice(4, 6), []]);
    for (const page of pages) expect(page.meta).toMatchObject({ limit: 2, total: 6, totalPage: 3 });
    const loaded = prisma.supportTicket.findMany.mock.calls.flatMap(([args]) => (args?.include ? [args.where] : []));
    expect(loaded).toEqual([{ id: { in: RANKED.slice(0, 2) } }, { id: { in: RANKED.slice(2, 4) } }, { id: { in: RANKED.slice(4, 6) } }]);
  });

  it('settles a tie on the older ticket, then on the id', async () => {
    const sameMoment = asked(4);
    const { service } = setup([
      ticket('b-newer', { createdAt: ago(10), messages: [sameMoment] }),
      ticket('c-older', { createdAt: ago(20), messages: [sameMoment] }),
      ticket('a-newer', { createdAt: ago(10), messages: [sameMoment] }),
    ]);
    expect(ids(await service.list({ sort: 'waiting' }))).toEqual(['c-older', 'a-newer', 'b-newer']);
  });

  it('ranks only what the filters keep, awaitingReply among them', async () => {
    const { service, prisma } = setup([...WAITING, ...QUEUE]);
    const result = await service.list({ sort: 'waiting', awaitingReply: true, limit: 100 });

    expect(ids(result)).toEqual(['urgent-new', 'high', 'asked', 'again', 'medium-silent', 'medium-twice', 'empty', 'wrote-back', 'low-oldest']);
    expect(result.meta.total).toBe((await service.stats()).needsReplyCount);
    // Each ticket's newest message is read with it, under the same filters.
    const ranked = prisma.supportTicket.findMany.mock.calls.find(([args]) => args?.select?.priority)?.[0];
    expect(ranked?.where).toMatchObject({ AND: [{ status: { notIn: ['RESOLVED', 'CLOSED'] } }] });
    expect(ranked?.select).toMatchObject({ messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { senderType: true, createdAt: true } } });
  });

  it('ranks under the search as well: asked has waited since 30h ago, again since 26h ago', async () => {
    const { service } = setup(QUEUE);
    expect(ids(await service.list({ sort: 'waiting', awaitingReply: true, search: 'about a' }))).toEqual(['asked', 'again']);
  });
});

describe('TicketsService.getById', () => {
  it('names a customer requester, whose record the page can open', async () => {
    const { service } = setup([ticket('t1', { messages: [asked(2)] }), ticket('t0', { status: 'RESOLVED' })]);
    const result = await service.getById('t1');

    expect(result.requester).toEqual({ id: 'cust-rahim', name: 'Rahim Uddin', email: 'rahim@example.com', isCustomer: true });
    // What the page reads today is unchanged.
    expect(result.platformUser).toEqual({ id: 'cust-rahim', name: 'Rahim Uddin', email: 'rahim@example.com', plan: { id: 'plan-pro', name: 'Monthly Pro' } });
    expect(result).toMatchObject({ id: 't1', assignedAdmin: null, requesterTickets: { total: 1, solved: 1 } });
    expect(result.messages).toHaveLength(1);
  });

  it('names a legacy platform user, who is not a customer', async () => {
    const { service } = setup([ticket('t1', { platformUserId: 'legacy-karim' })]);
    const result = await service.getById('t1');

    expect(result.requester).toEqual({ id: 'legacy-karim', name: 'Karim Mia', email: 'karim@example.com', isCustomer: false });
    expect(result.platformUser).toEqual({ id: 'legacy-karim', name: 'Karim Mia', email: 'karim@example.com', plan: null });
  });

  it("has no requester when the person's record is gone or is not a customer's", async () => {
    for (const platformUserId of ['gone', 'admin-nadia']) {
      const { service } = setup([ticket('t1', { platformUserId })]);
      expect(await service.getById('t1')).toMatchObject({ requester: null, platformUser: null });
    }
  });

  it('is a 404 for an unknown ticket', async () => {
    await expect(setup([]).service.getById('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ListTicketsQueryDto', () => {
  // As the global ValidationPipe reads a query string: unknown fields are refused.
  const parse = async (query: Record<string, unknown>) => {
    const dto = plainToInstance(ListTicketsQueryDto, query);
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    return { dto, errors: errors.map((error) => error.property).sort() };
  };

  it('takes the unassigned filter, awaitingReply and the sort next to the old filters', async () => {
    const { dto, errors } = await parse({ status: 'IN_QUEUE', assignedToAdminId: 'none', awaitingReply: 'true', sort: 'waiting', page: '2', limit: '20' });
    expect(errors).toEqual([]);
    expect(dto).toMatchObject({ status: 'IN_QUEUE', assignedToAdminId: 'none', awaitingReply: true, sort: 'waiting', page: 2, limit: 20 });

    expect((await parse({ awaitingReply: 'false' })).dto.awaitingReply).toBe(false);
    expect((await parse({ awaitingReply: '1' })).dto.awaitingReply).toBe(true);
    expect((await parse({ sort: 'queue' })).errors).toEqual([]);
    expect((await parse({})).errors).toEqual([]);
  });

  it('refuses a flag that is neither true nor false, and any other sort', async () => {
    expect((await parse({ awaitingReply: 'yes', sort: 'newest' })).errors).toEqual(['awaitingReply', 'sort']);
    expect((await parse({ awaitingReply: '', sort: '' })).errors).toEqual(['awaitingReply', 'sort']);
  });
});
