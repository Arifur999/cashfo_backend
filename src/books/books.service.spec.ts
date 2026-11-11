import { BooksService, buildUpdate } from './books.service.js';

describe('BooksService.year', () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date('2026-11-03T08:00:00.000Z') }));
  afterEach(() => vi.useRealTimers());

  const setup = ({ firstLog = '2024-12-30', startedAt = null as string | null } = {}) => {
    const prisma = {
      bookLog: {
        findMany: vi.fn().mockResolvedValue([
          { bookId: 'a', date: new Date('2026-01-31T00:00:00.000Z'), pages: 20 },
          { bookId: 'a', date: new Date('2026-03-01T00:00:00.000Z'), pages: 15 },
          { bookId: 'b', date: new Date('2026-03-02T00:00:00.000Z'), pages: 10 },
        ]),
      },
      bookGoal: { findUnique: vi.fn().mockResolvedValue({ target: 12 }) },
      $queryRaw: vi.fn().mockResolvedValue(firstLog ? [{ month: '2026-01' }, { month: firstLog.slice(0, 7) }] : []),
      book: { findMany: vi.fn().mockResolvedValue(startedAt ? [{ startedAt: new Date(startedAt), finishedAt: null }] : []) },
    };
    return { service: new BooksService(prisma as never), prisma };
  };

  it('adds up a year of pages by month, in all and per book', async () => {
    const { service, prisma } = setup();
    const view = await service.year('user-1', 2026);
    expect(prisma.bookLog.findMany.mock.calls[0][0].where).toEqual({
      userId: 'user-1',
      date: { gte: new Date('2026-01-01T00:00:00.000Z'), lt: new Date('2027-01-01T00:00:00.000Z') },
    });
    expect(view.months.slice(0, 4)).toEqual([20, 0, 25, 0]);
    expect(view.bookMonths).toEqual({ a: [20, 0, 15, 0, 0, 0, 0, 0, 0, 0, 0, 0], b: [0, 0, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0] });
    expect(view.goalTarget).toBe(12);
  });

  it('offers every year from the first one with reading to this one', async () => {
    await expect(setup().service.year('user-1', 2026)).resolves.toMatchObject({ years: [2026, 2025, 2024] });
    // A book started on a Dhaka 1 January counts for that year.
    await expect(setup({ firstLog: '', startedAt: '2022-12-31T19:00:00.000Z' }).service.year('user-1', 2026)).resolves.toMatchObject({
      years: [2026, 2025, 2024, 2023],
    });
    await expect(setup({ firstLog: '' }).service.year('user-1', 2026)).resolves.toMatchObject({ years: [2026] });
  });
});

describe('buildUpdate: pausing a book', () => {
  const now = new Date('2026-11-03T08:00:00.000Z');
  const book = (more: Partial<{ status: 'WANT_TO_READ' | 'READING' | 'FINISHED'; pagesRead: number; pausedAt: Date | null }> = {}) =>
    ({
      id: 'b',
      userId: 'user-1',
      title: 'Deep Work',
      author: '',
      totalPages: 296,
      pagesRead: 60,
      status: 'READING',
      color: 'walnut',
      startedAt: new Date('2026-10-01T00:00:00.000Z'),
      finishedAt: null,
      pausedAt: null,
      createdAt: now,
      updatedAt: now,
      ...more,
    }) as never;

  it('keeps the page while paused, and resumes', () => {
    const paused = buildUpdate(book(), { paused: true }, now).data;
    expect(paused).toMatchObject({ status: 'READING', pagesRead: 60, pausedAt: now });
    const earlier = new Date('2026-11-01T00:00:00.000Z');
    expect(buildUpdate(book({ pausedAt: earlier }), { paused: true }, now).data.pausedAt).toBe(earlier);
    expect(buildUpdate(book({ pausedAt: earlier }), { paused: false }, now).data.pausedAt).toBeNull();
  });

  it('takes it up again on a new page, and stays paused through other edits', () => {
    const earlier = new Date('2026-11-01T00:00:00.000Z');
    expect(buildUpdate(book({ pausedAt: earlier }), { pagesRead: 80 }, now).data.pausedAt).toBeNull();
    expect(buildUpdate(book({ pausedAt: earlier }), { title: 'Deep Work 2' }, now).data.pausedAt).toBe(earlier);
    expect(buildUpdate(book({ pausedAt: earlier }), { status: 'FINISHED' }, now).data.pausedAt).toBeNull();
  });

  it('pauses only a book being read', () => {
    expect(() => buildUpdate(book({ status: 'WANT_TO_READ', pagesRead: 0 }), { paused: true }, now)).toThrow('Only a book being read can be paused');
  });
});

describe('buildUpdate: details, summary and logging', () => {
  const now = new Date('2026-11-03T08:00:00.000Z');
  const book = (more: Record<string, unknown> = {}) =>
    ({
      id: 'b',
      userId: 'user-1',
      title: 'Deep Work',
      author: '',
      totalPages: 296,
      pagesRead: 296,
      status: 'READING',
      color: 'walnut',
      startedAt: new Date('2026-10-01T00:00:00.000Z'),
      finishedAt: null,
      pausedAt: null,
      price: null,
      shelf: 'other',
      summary: '',
      summaryAt: null,
      createdAt: now,
      updatedAt: now,
      ...more,
    }) as never;

  it('leaves the shelf and the page alone on a details edit', () => {
    // At the last page but not marked finished: a new title keeps it so.
    const { data, logDelta } = buildUpdate(book(), { title: 'Deep Work (2nd)', price: 450, shelf: 'self' }, now);
    expect(data).toMatchObject({ title: 'Deep Work (2nd)', status: 'READING', pagesRead: 296, price: 450, shelf: 'self' });
    expect(logDelta).toBe(0);
  });

  it('logs only a page the reader reported, not a status move', () => {
    expect(buildUpdate(book({ pagesRead: 60 }), { pagesRead: 80 }, now).logDelta).toBe(20);
    expect(buildUpdate(book({ pagesRead: 60 }), { status: 'FINISHED' }, now)).toMatchObject({ data: { status: 'FINISHED', pagesRead: 296 }, logDelta: 0 });
  });

  it('dates a summary when it changes, and clears the date with it', () => {
    const written = buildUpdate(book(), { summary: '  A book about focus.\r\n\r\nRead it twice.  ' }, now).data;
    expect(written).toMatchObject({ summary: 'A book about focus.\n\nRead it twice.', summaryAt: now });
    const earlier = new Date('2026-10-20T00:00:00.000Z');
    expect(buildUpdate(book({ summary: 'Same', summaryAt: earlier }), { summary: 'Same' }, now).data.summaryAt).toBe(earlier);
    expect(buildUpdate(book({ summary: 'Same', summaryAt: earlier }), { summary: '' }, now).data).toMatchObject({ summary: '', summaryAt: null });
  });

  it('clears a price sent as null', () => {
    expect(buildUpdate(book({ price: 360 }), { price: null }, now).data.price).toBeNull();
    expect(buildUpdate(book({ price: 360 }), { title: 'X' }, now).data.price).toBe(360);
  });
});

describe('BooksService.logReading', () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date('2026-11-03T08:00:00.000Z') }));
  afterEach(() => vi.useRealTimers());

  const setup = (latest: { date: string; pages: number; fromPage: number | null } | null, more: Record<string, unknown> = {}) => {
    const current = {
      id: 'b',
      userId: 'user-1',
      title: 'T',
      author: '',
      color: 'walnut',
      totalPages: 320,
      pagesRead: 122,
      status: 'READING',
      pausedAt: new Date(),
      updatedAt: new Date(),
      ...more,
    };
    const saved = (data: Record<string, unknown>) => ({
      startedAt: null,
      finishedAt: null,
      price: null,
      shelf: 'other',
      summary: '',
      summaryAt: null,
      createdAt: new Date(),
      ...current,
      ...data,
    });
    const tx = { book: { update: vi.fn().mockImplementation(({ data }) => saved(data)) }, bookLog: { upsert: vi.fn() } };
    const prisma = {
      book: { findFirst: vi.fn().mockResolvedValue(current) },
      bookLog: {
        findFirst: vi
          .fn()
          .mockResolvedValue(latest ? { date: new Date(`${latest.date}T00:00:00.000Z`), pages: latest.pages, fromPage: latest.fromPage } : null),
        count: vi.fn().mockResolvedValue(0),
      },
      $transaction: vi.fn().mockImplementation((fn: (client: typeof tx) => unknown) => fn(tx)),
    };
    return { service: new BooksService(prisma as never), tx };
  };

  it('logs a new day from where the book is, and takes a paused book up again', async () => {
    const { service, tx } = setup({ date: '2026-11-01', pages: 14, fromPage: 108 });
    const result = await service.logReading('user-1', 'b', { date: '2026-11-03', toPage: 142 });
    expect(result.day).toEqual({ date: '2026-11-03', from: 122, to: 142 });
    expect(tx.book.update.mock.calls[0][0].data).toEqual({ pagesRead: 142, pausedAt: null });
    expect(tx.bookLog.upsert.mock.calls[0][0].create).toMatchObject({ pages: 20, fromPage: 122 });
  });

  it('corrects the latest day from where that day began', async () => {
    const { service, tx } = setup({ date: '2026-11-03', pages: 20, fromPage: 122 }, { pagesRead: 142 });
    await expect(service.logReading('user-1', 'b', { date: '2026-11-03', toPage: 130 })).resolves.toMatchObject({ day: { from: 122, to: 130 } });
    expect(tx.bookLog.upsert.mock.calls[0][0].update).toEqual({ pages: 8, fromPage: 122 });
  });

  it('closes the days before the latest one, and refuses pages out of the book', async () => {
    await expect(
      setup({ date: '2026-11-02', pages: 14, fromPage: 108 }).service.logReading('user-1', 'b', { date: '2026-11-01', toPage: 150 }),
    ).rejects.toThrow('Reading after this date is already logged. Pick 2026-11-02 or later');
    await expect(setup(null).service.logReading('user-1', 'b', { date: '2026-11-04', toPage: 150 })).rejects.toThrow("The date can't be in the future");
    await expect(setup(null).service.logReading('user-1', 'b', { date: '2026-11-03', toPage: 122 })).rejects.toThrow('Write a page after 122');
    await expect(setup(null).service.logReading('user-1', 'b', { date: '2026-11-03', toPage: 321 })).rejects.toThrow('This book has 320 pages');
    await expect(setup(null, { status: 'WANT_TO_READ' }).service.logReading('user-1', 'b', { date: '2026-11-03', toPage: 150 })).rejects.toThrow(
      'Start reading this book first',
    );
  });

  it('finishes the book at the last page unless asked not to, on the day logged', async () => {
    const yesterday = setup(null);
    await yesterday.service.logReading('user-1', 'b', { date: '2026-11-02', toPage: 320 });
    expect(yesterday.tx.book.update.mock.calls[0][0].data).toMatchObject({ status: 'FINISHED', finishedAt: new Date('2026-11-02T06:00:00.000Z') });
    const notYet = setup(null);
    await notYet.service.logReading('user-1', 'b', { date: '2026-11-03', toPage: 320, finish: false });
    expect(notYet.tx.book.update.mock.calls[0][0].data).toEqual({ pagesRead: 320, pausedAt: null });
  });
});
