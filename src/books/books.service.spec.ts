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
        aggregate: vi.fn().mockResolvedValue({ _min: { date: firstLog ? new Date(`${firstLog}T00:00:00.000Z`) : null } }),
      },
      bookGoal: { findUnique: vi.fn().mockResolvedValue({ target: 12 }) },
      book: { aggregate: vi.fn().mockResolvedValue({ _min: { startedAt: startedAt ? new Date(startedAt) : null, finishedAt: null } }) },
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
    const paused = buildUpdate(book(), { paused: true }, now);
    expect(paused).toMatchObject({ status: 'READING', pagesRead: 60, pausedAt: now });
    const earlier = new Date('2026-11-01T00:00:00.000Z');
    expect(buildUpdate(book({ pausedAt: earlier }), { paused: true }, now).pausedAt).toBe(earlier);
    expect(buildUpdate(book({ pausedAt: earlier }), { paused: false }, now).pausedAt).toBeNull();
  });

  it('takes it up again on a new page, and stays paused through other edits', () => {
    const earlier = new Date('2026-11-01T00:00:00.000Z');
    expect(buildUpdate(book({ pausedAt: earlier }), { pagesRead: 80 }, now).pausedAt).toBeNull();
    expect(buildUpdate(book({ pausedAt: earlier }), { title: 'Deep Work 2' }, now).pausedAt).toBe(earlier);
    expect(buildUpdate(book({ pausedAt: earlier }), { status: 'FINISHED' }, now).pausedAt).toBeNull();
  });

  it('pauses only a book being read', () => {
    expect(() => buildUpdate(book({ status: 'WANT_TO_READ', pagesRead: 0 }), { paused: true }, now)).toThrow('Only a book being read can be paused');
  });
});
