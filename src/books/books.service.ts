import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BookNoteKind, BookStatus, Prisma, type Book, type BookNote, type BookShelf } from '@prisma/client';
import { dhakaDateKey, dhakaDateOnly, dhakaYear } from '../common/dhaka.js';
import { cleanLongText } from '../common/long-text.js';
import { compareAndSwap, settleShelf, type SettledShelf, type ShelfItem, type ShelfMessages } from '../common/shelf.js';
import { cleanOptionalText, cleanRequiredText } from '../common/text.js';
import { createWithinCap } from '../common/user-cap.js';
import { clearYearlyGoal, setYearlyGoal, type SetYearlyGoalDto, type YearlyGoal } from '../common/yearly-goal.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BOOK_COLORS, BOOK_SHELVES } from './book-colors.js';
import { CreateBookDto } from './dto/create-book.dto.js';
import { CreateBookNoteDto, NOTE_LINE_MAX, NOTE_TEXT_MAX, UpdateBookNoteDto } from './dto/create-book-note.dto.js';
import { CreateBookShelfDto } from './dto/create-book-shelf.dto.js';
import { LogReadingDto } from './dto/log-reading.dto.js';
import { UpdateBookDto } from './dto/update-book.dto.js';
import { cleanMarks, dayOfReading, finishedOn, isRealDay, pastDay, readingStart, storedMarks, type NoteMark } from './library.js';
import { readingSummary, type ReadingSummary } from './reading.js';

// Per-user cap, enforced by createWithinCap.
const MAX_BOOKS = 500;
const MAX_SHELVES = 50;

const MAX_TITLE_LENGTH = 120;
const MAX_AUTHOR_LENGTH = 80;
const MAX_SHELF_NAME_LENGTH = 40;
const MAX_SUMMARY_LENGTH = 8000;
const MAX_NOTES_PER_BOOK = 500;
// GET /api/books/pages reads at most about three years at once.
const MAX_RANGE_DAYS = 3 * 366;

// A reader's own shelves get the cover colours the built-in ones don't use
// first, then go round again.
const OWN_SHELF_COLORS = [
  'oxblood',
  'terracotta',
  'sage',
  'plum',
  'navy',
  'teal',
  'walnut',
  'forest',
  'mustard',
  'slate',
] as const satisfies readonly (typeof BOOK_COLORS)[number][];

export interface BookView {
  id: string;
  title: string;
  author: string;
  totalPages: number;
  pagesRead: number;
  status: BookStatus;
  color: string;
  startedAt: string | null;
  finishedAt: string | null;
  // Asia/Dhaka calendar year of finishedAt -- so the client never has to guess
  // the timezone when counting "finished this year".
  finishedYear: number | null;
  // Paused while being read (still READING, its page kept).
  pausedAt: string | null;
  // What the reader paid, in taka; null when they didn't say.
  price: number | null;
  // A built-in shelf key or the id of one of the reader's own shelves.
  shelf: string;
  // Whether a summary is written (the text itself comes with GET :id).
  hasSummary: boolean;
  summaryAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BookDetailView extends BookView {
  summary: string;
}

export interface BookNoteView {
  id: string;
  bookId: string;
  page: number | null;
  kind: BookNoteKind;
  // The line from the book ('' when none).
  line: string;
  text: string;
  date: string; // YYYY-MM-DD, the day the note is for
  marks: NoteMark[];
  createdAt: string;
}

export interface BookShelfView {
  id: string;
  name: string;
  color: string;
}

// How many notes a book has, and the days of its first and last.
export interface NoteStats {
  count: number;
  first: string;
  last: string;
}

// A book's latest day of reading: the day, and the page it began and ended on.
export interface ReadingDayView {
  date: string;
  from: number;
  to: number;
}

export interface BooksOverview {
  year: number; // the current Asia/Dhaka year
  goalTarget: number | null; // this year's "finish N books" goal
  books: BookView[];
  // The streak, the best run and this week's pages, over every book.
  reading: ReadingSummary;
  // Pages read today in each book that has any, by book id.
  pagesToday: Record<string, number>;
  // The notes on each book being read, oldest first, by book id.
  notes: Record<string, BookNoteView[]>;
  // The reader's own shelves, oldest first.
  shelves: BookShelfView[];
  // Every book with notes, by book id.
  noteStats: Record<string, NoteStats>;
  // The pages read in each book on each of the last seven days (today the
  // last); only days with reading.
  lastWeek: { bookId: string; date: string; pages: number }[];
  // Each book being read: its latest day of reading, and the day before
  // that one (the earliest day that latest one can be moved back to).
  lastLogs: Record<string, { latest: ReadingDayView; before: string | null }>;
}

// GET :id -- the book page.
export interface BookDetail {
  book: BookDetailView;
  // Every note, oldest first.
  notes: BookNoteView[];
  shelves: BookShelfView[];
}

// Library › Dashboard: one year's reading, month by month (Asia/Dhaka
// months), in all and in each book, that year's goal, and every year from
// the first one with reading in it to this one (newest first).
export interface BookYearView {
  year: number;
  goalTarget: number | null;
  years: number[];
  // Pages read in each month, January first.
  months: number[];
  // The same for each book read that year, by book id.
  bookMonths: Record<string, number[]>;
  // Every month ('YYYY-MM') with reading in it or a book started or
  // finished, oldest first -- the period picker greys the others.
  activeMonths: string[];
}

export interface BookPagesView {
  from: string;
  to: string;
  total: number;
  byBook: Record<string, number>;
}

// The oldest year the dashboard offers, however far back the first log is.
const MAX_YEARS = 30;

const dayKey = (date: Date): string => date.toISOString().slice(0, 10);
const shiftDay = (day: string, by: number): string => new Date(Date.parse(`${day}T00:00:00.000Z`) + by * 86_400_000).toISOString().slice(0, 10);
const asDate = (day: string): Date => new Date(`${day}T00:00:00.000Z`);

function toNoteView(note: BookNote): BookNoteView {
  return {
    id: note.id,
    bookId: note.bookId,
    page: note.page,
    kind: note.kind,
    line: note.line,
    text: note.text,
    date: dayKey(note.date),
    marks: storedMarks(note.marks),
    createdAt: note.createdAt.toISOString(),
  };
}

const toShelfView = (shelf: BookShelf): BookShelfView => ({ id: shelf.id, name: shelf.name, color: shelf.color });

// Today's log of a book moves by as much as its page moved: up when reading
// on, back down when a slip is corrected the same day. A day that ends at 0
// (or starts with a step back) leaves no row.
async function logPages(tx: Prisma.TransactionClient, book: Pick<Book, 'id' | 'userId'>, from: number, delta: number, now: Date): Promise<void> {
  if (delta === 0) return;
  const date = dhakaDateOnly(now);
  const existing = await tx.bookLog.findUnique({ where: { bookId_date: { bookId: book.id, date } } });
  const pages = Math.max(0, (existing?.pages ?? 0) + delta);
  if (pages === 0) {
    if (existing) await tx.bookLog.delete({ where: { id: existing.id } });
  } else if (existing) {
    await tx.bookLog.update({ where: { id: existing.id }, data: { pages } });
  } else {
    await tx.bookLog.create({ data: { bookId: book.id, userId: book.userId, date, pages, fromPage: from } });
  }
}

function toView(book: Book): BookView {
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    totalPages: book.totalPages,
    pagesRead: book.pagesRead,
    status: book.status,
    color: book.color,
    startedAt: book.startedAt?.toISOString() ?? null,
    finishedAt: book.finishedAt?.toISOString() ?? null,
    finishedYear: book.finishedAt ? dhakaYear(book.finishedAt) : null,
    pausedAt: book.pausedAt?.toISOString() ?? null,
    price: book.price === null ? null : Number(book.price),
    shelf: book.shelf,
    hasSummary: book.summary !== '',
    summaryAt: book.summaryAt?.toISOString() ?? null,
    createdAt: book.createdAt.toISOString(),
    updatedAt: book.updatedAt.toISOString(),
  };
}

const toDetailView = (book: Book): BookDetailView => ({ ...toView(book), summary: book.summary });

const SHELVES = { todo: BookStatus.WANT_TO_READ, doing: BookStatus.READING, done: BookStatus.FINISHED };
const MESSAGES: ShelfMessages = {
  overTotal: "Pages read can't be more than the total pages",
  notStarted: "A book you haven't started can't have pages read",
};

function asShelfItem(book: Book): ShelfItem<BookStatus> {
  return { status: book.status, progress: book.pagesRead, startedAt: book.startedAt, doneAt: book.finishedAt };
}

// The note's line and words as stored. A thought needs its words; a
// highlight or an underline needs the line from the book or some words.
function noteText(kind: BookNoteKind, rawLine: string, rawText: string): { line: string; text: string } {
  const line = cleanLongText(rawLine, 'line', NOTE_LINE_MAX);
  const text = cleanLongText(rawText, 'note', NOTE_TEXT_MAX);
  if (kind === BookNoteKind.THOUGHT && !text) throw new BadRequestException('Write your thought');
  if (!text && !line) throw new BadRequestException('Write the line from the book or a few words of your own');
  return { line, text };
}

export interface BookUpdate {
  data: {
    title: string;
    author: string;
    totalPages: number;
    pagesRead: number;
    status: BookStatus;
    color: string;
    startedAt: Date | null;
    finishedAt: Date | null;
    pausedAt: Date | null;
    price: number | Prisma.Decimal | null;
    shelf: string;
    summary: string;
    summaryAt: Date | null;
  };
  // Pages read today to log: only a page the reader reported (a status move
  // or a page-count fix is not reading).
  logDelta: number;
}

// The new column values for an edit of `current`. Pure, so it can be re-run on
// a fresh read when a concurrent write is detected. A plain details edit
// (title, price, shelf, summary...) leaves the shelf, the page and the dates
// as they are -- so a book at its last page but not marked finished stays
// unfinished.
export function buildUpdate(current: Book, dto: UpdateBookDto, now: Date): BookUpdate {
  const title = dto.title !== undefined ? cleanRequiredText(dto.title, 'title', MAX_TITLE_LENGTH) : current.title;
  const author = dto.author !== undefined ? cleanOptionalText(dto.author, 'author', MAX_AUTHOR_LENGTH) : current.author;
  const totalPages = dto.totalPages ?? current.totalPages;
  const moves = dto.status !== undefined || dto.pagesRead !== undefined || dto.totalPages !== undefined;
  const settled: SettledShelf<BookStatus> = moves
    ? settleShelf(SHELVES, asShelfItem(current), { status: dto.status, progress: dto.pagesRead, total: totalPages }, now, MESSAGES)
    : { ...asShelfItem(current), progressReported: false };
  if (dto.paused === true && settled.status !== BookStatus.READING) throw new BadRequestException('Only a book being read can be paused');
  // Paused only while being read: an explicit pause or resume, else reading
  // on (a new page) takes it up again, and any other edit leaves it be.
  const pausedAt =
    settled.status !== BookStatus.READING
      ? null
      : dto.paused !== undefined
        ? dto.paused
          ? (current.pausedAt ?? now)
          : null
        : settled.progress !== current.pagesRead
          ? null
          : current.pausedAt;
  const summary = dto.summary !== undefined ? cleanLongText(dto.summary, 'summary', MAX_SUMMARY_LENGTH) : current.summary;
  const summaryAt = summary === current.summary ? current.summaryAt : summary ? now : null;
  return {
    data: {
      title,
      author,
      totalPages,
      pagesRead: settled.progress,
      status: settled.status,
      color: dto.color ?? current.color,
      startedAt: settled.startedAt,
      finishedAt: settled.doneAt,
      pausedAt,
      price: dto.price !== undefined ? dto.price : current.price,
      shelf: dto.shelf ?? current.shelf,
      summary,
      summaryAt,
    },
    logDelta: settled.progressReported ? settled.progress - current.pagesRead : 0,
  };
}

@Injectable()
export class BooksService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(userId: string): Promise<BooksOverview> {
    const now = new Date();
    const year = dhakaYear(now);
    const today = dhakaDateKey(now);
    // One after the other, not Promise.all: the local dev database (`prisma dev`)
    // drops the connection when two queries run at once (P1017), which made
    // this route fail with a 500 every time.
    const books = await this.prisma.book.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' } });
    const goal = await this.prisma.bookGoal.findUnique({ where: { userId_year: { userId, year } } });
    const days = await this.prisma.bookLog.groupBy({ by: ['date'], where: { userId }, _sum: { pages: true } });
    const week = await this.prisma.bookLog.findMany({
      where: { userId, date: { gte: asDate(shiftDay(today, -6)) } },
      select: { bookId: true, date: true, pages: true },
    });
    const reading = books.filter((book) => book.status === BookStatus.READING);
    const readingIds = reading.map((book) => book.id);
    const notes = readingIds.length ? await this.prisma.bookNote.findMany({ where: { bookId: { in: readingIds } }, orderBy: { createdAt: 'asc' } }) : [];
    const logs = readingIds.length
      ? await this.prisma.bookLog.findMany({
          where: { bookId: { in: readingIds } },
          orderBy: { date: 'desc' },
          select: { bookId: true, date: true, pages: true, fromPage: true },
        })
      : [];
    const stats = await this.prisma.bookNote.groupBy({
      by: ['bookId'],
      where: { book: { userId } },
      _count: { _all: true },
      _min: { date: true },
      _max: { date: true },
    });
    const shelves = await this.prisma.bookShelf.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
    const owner = await this.prisma.user.findUnique({ where: { id: userId }, select: { weekStart: true } });

    const lastLogs: BooksOverview['lastLogs'] = {};
    for (const book of reading) {
      const [latest, before] = logs.filter((log) => log.bookId === book.id);
      if (latest)
        lastLogs[book.id] = { latest: { date: dayKey(latest.date), ...dayOfReading(latest, book.pagesRead) }, before: before ? dayKey(before.date) : null };
    }

    return {
      year,
      goalTarget: goal?.target ?? null,
      books: books.map(toView),
      reading: readingSummary(
        days.map((day) => ({ date: dayKey(day.date), pages: day._sum.pages ?? 0 })),
        today,
        owner?.weekStart,
      ),
      pagesToday: Object.fromEntries(week.filter((log) => dayKey(log.date) === today).map((log) => [log.bookId, log.pages])),
      notes: Object.fromEntries(readingIds.map((id) => [id, notes.filter((note) => note.bookId === id).map(toNoteView)])),
      shelves: shelves.map(toShelfView),
      noteStats: Object.fromEntries(
        stats.map((row) => [
          row.bookId,
          { count: row._count._all, first: row._min.date ? dayKey(row._min.date) : '', last: row._max.date ? dayKey(row._max.date) : '' },
        ]),
      ),
      lastWeek: week.map((log) => ({ bookId: log.bookId, date: dayKey(log.date), pages: log.pages })),
      lastLogs,
    };
  }

  async detail(userId: string, id: string): Promise<BookDetail> {
    const book = await this.requireBook(userId, id);
    const notes = await this.prisma.bookNote.findMany({ where: { bookId: id }, orderBy: { createdAt: 'asc' } });
    const shelves = await this.prisma.bookShelf.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
    return { book: toDetailView(book), notes: notes.map(toNoteView), shelves: shelves.map(toShelfView) };
  }

  async year(userId: string, year: number): Promise<BookYearView> {
    // BookLog.date is the Dhaka day at UTC midnight, so UTC months are Dhaka's.
    const logs = await this.prisma.bookLog.findMany({
      where: { userId, date: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } },
      select: { bookId: true, date: true, pages: true },
    });
    const goal = await this.prisma.bookGoal.findUnique({ where: { userId_year: { userId, year } } });
    const logMonths = await this.prisma.$queryRaw<
      { month: string }[]
    >`SELECT DISTINCT to_char("date", 'YYYY-MM') AS "month" FROM "BookLog" WHERE "userId" = ${userId}`;
    const dated = await this.prisma.book.findMany({ where: { userId, startedAt: { not: null } }, select: { startedAt: true, finishedAt: true } });

    const months = Array<number>(12).fill(0);
    const bookMonths: Record<string, number[]> = {};
    for (const log of logs) {
      const month = log.date.getUTCMonth();
      months[month] += log.pages;
      (bookMonths[log.bookId] ??= Array<number>(12).fill(0))[month] += log.pages;
    }

    const active = new Set(logMonths.map((row) => row.month));
    for (const book of dated) {
      for (const at of [book.startedAt, book.finishedAt]) if (at) active.add(dhakaDateKey(at).slice(0, 7));
    }
    const activeMonths = [...active].sort();

    const current = dhakaYear(new Date());
    const first = activeMonths[0] ? Number(activeMonths[0].slice(0, 4)) : current;
    const newest = Math.max(current, year);
    const oldest = Math.max(newest - MAX_YEARS + 1, Math.min(year, current, first));
    const years = Array.from({ length: newest - oldest + 1 }, (_, i) => newest - i);
    return { year, goalTarget: goal?.target ?? null, years, months, bookMonths, activeMonths };
  }

  // Pages read from one day to another (both in), in all and in each book.
  async pages(userId: string, from: string, to: string): Promise<BookPagesView> {
    if (!isRealDay(from) || !isRealDay(to)) throw new BadRequestException('Pick real dates');
    if (from > to) throw new BadRequestException('The first date must come before the last');
    if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > MAX_RANGE_DAYS) throw new BadRequestException('Pick at most three years at a time');
    const rows = await this.prisma.bookLog.groupBy({ by: ['bookId'], where: { userId, date: { gte: asDate(from), lte: asDate(to) } }, _sum: { pages: true } });
    const byBook = Object.fromEntries(rows.map((row) => [row.bookId, row._sum.pages ?? 0]));
    return { from, to, total: rows.reduce((sum, row) => sum + (row._sum.pages ?? 0), 0), byBook };
  }

  async create(userId: string, dto: CreateBookDto): Promise<BookView> {
    const title = cleanRequiredText(dto.title, 'title', MAX_TITLE_LENGTH);
    const author = cleanOptionalText(dto.author ?? '', 'author', MAX_AUTHOR_LENGTH);
    const shelf = await this.resolveShelf(userId, dto.shelf ?? 'other');
    const settled = settleShelf(SHELVES, null, { status: dto.status, progress: dto.pagesRead, total: dto.totalPages }, new Date(), MESSAGES);
    const book = await createWithinCap(
      this.prisma,
      userId,
      'books',
      MAX_BOOKS,
      `You can keep up to ${MAX_BOOKS} books`,
      (tx) => tx.book.count({ where: { userId } }),
      (tx) =>
        tx.book.create({
          data: {
            userId,
            title,
            author,
            totalPages: dto.totalPages,
            pagesRead: settled.progress,
            status: settled.status,
            color: dto.color ?? 'walnut',
            startedAt: settled.startedAt,
            finishedAt: settled.doneAt,
            price: dto.price ?? null,
            shelf,
          },
        }),
    );
    return toView(book);
  }

  // Every column is derived from the row as it was read, so the write only
  // lands if the row is unchanged (see compareAndSwap). A page the reader
  // reported is logged for today in the same transaction.
  async update(userId: string, id: string, dto: UpdateBookDto): Promise<BookDetailView> {
    if (dto.shelf !== undefined) await this.resolveShelf(userId, dto.shelf);
    return compareAndSwap(async () => {
      const current = await this.requireBook(userId, id);
      const now = new Date();
      const { data, logDelta } = buildUpdate(current, dto, now);
      const book = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.book.update({ where: { id, userId, updatedAt: current.updatedAt }, data });
        await logPages(tx, updated, current.pagesRead, logDelta, now);
        return updated;
      });
      return toDetailView(book);
    }, 'This book was changed elsewhere -- please try again');
  }

  // Reading now's "Log today's reading": the reader read up to `toPage` on
  // `date`. A new day begins where the book is; the latest day already
  // logged can be corrected; earlier days are closed.
  async logReading(userId: string, id: string, dto: LogReadingDto): Promise<{ book: BookView; day: ReadingDayView }> {
    return compareAndSwap(async () => {
      const book = await this.requireBook(userId, id);
      const now = new Date();
      const today = dhakaDateKey(now);
      const day = pastDay(dto.date, today);
      if (book.status !== BookStatus.READING) throw new BadRequestException('Start reading this book first');
      const latestRow = await this.prisma.bookLog.findFirst({ where: { bookId: id }, orderBy: { date: 'desc' } });
      const latest = latestRow ? { date: dayKey(latestRow.date), pages: latestRow.pages, fromPage: latestRow.fromPage } : null;
      const hasLogOn = latest !== null && day < latest.date && (await this.prisma.bookLog.count({ where: { bookId: id, date: asDate(day) } })) > 0;
      const { from } = readingStart(day, latest, book.pagesRead, hasLogOn);
      if (dto.toPage > book.totalPages) throw new BadRequestException(`This book has ${book.totalPages} pages`);
      if (dto.toPage <= from) throw new BadRequestException(`Write a page after ${from}`);
      const finished = dto.finish !== false && dto.toPage === book.totalPages;
      const updated = await this.prisma.$transaction(async (tx) => {
        const saved = await tx.book.update({
          where: { id, userId, updatedAt: book.updatedAt },
          data: {
            pagesRead: dto.toPage,
            pausedAt: null,
            ...(finished ? { status: BookStatus.FINISHED, finishedAt: finishedOn(day, today, now) } : {}),
          },
        });
        await tx.bookLog.upsert({
          where: { bookId_date: { bookId: id, date: asDate(day) } },
          update: { pages: dto.toPage - from, fromPage: from },
          create: { bookId: id, userId, date: asDate(day), pages: dto.toPage - from, fromPage: from },
        });
        return saved;
      });
      return { book: toView(updated), day: { date: day, from, to: dto.toPage } };
    }, 'This book was changed elsewhere -- please try again');
  }

  async remove(userId: string, id: string): Promise<{ id: string }> {
    // Its reading reminders go with it (Reminder.targetKey is no foreign key).
    const [{ count }] = await this.prisma.$transaction([
      this.prisma.book.deleteMany({ where: { id, userId } }),
      this.prisma.reminder.deleteMany({ where: { userId, kind: 'BOOK', targetKey: id } }),
    ]);
    if (count === 0) throw new NotFoundException('Book not found');
    return { id };
  }

  async createShelf(userId: string, dto: CreateBookShelfDto): Promise<BookShelfView> {
    const name = cleanRequiredText(dto.name, 'shelf name', MAX_SHELF_NAME_LENGTH);
    const nameKey = name.toLocaleLowerCase();
    try {
      const shelf = await createWithinCap(
        this.prisma,
        userId,
        'book-shelves',
        MAX_SHELVES,
        `You can make up to ${MAX_SHELVES} shelves`,
        (tx) => tx.bookShelf.count({ where: { userId } }),
        async (tx) => {
          if (await tx.bookShelf.findUnique({ where: { userId_nameKey: { userId, nameKey } } }))
            throw new ConflictException('A shelf with this name already exists');
          const count = await tx.bookShelf.count({ where: { userId } });
          return tx.bookShelf.create({ data: { userId, name, nameKey, color: OWN_SHELF_COLORS[count % OWN_SHELF_COLORS.length] } });
        },
      );
      return toShelfView(shelf);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('A shelf with this name already exists');
      throw error;
    }
  }

  async addNote(userId: string, bookId: string, dto: CreateBookNoteDto): Promise<BookNoteView> {
    const book = await this.requireBook(userId, bookId);
    if (dto.page > book.totalPages) throw new BadRequestException(`This book has ${book.totalPages} pages`);
    const today = dhakaDateKey(new Date());
    const date = pastDay(dto.date ?? today, today);
    const kind = dto.kind ?? BookNoteKind.THOUGHT;
    const { line, text } = noteText(kind, dto.line ?? '', dto.text ?? '');
    const marks = dto.marks ? cleanMarks(dto.marks, text) : null;
    const note = await createWithinCap(
      this.prisma,
      bookId,
      'book-notes',
      MAX_NOTES_PER_BOOK,
      `A book can keep up to ${MAX_NOTES_PER_BOOK} notes`,
      (tx) => tx.bookNote.count({ where: { bookId } }),
      (tx) =>
        tx.bookNote.create({
          data: { bookId, page: dto.page, kind, line, text, date: asDate(date), marks: marks ? (marks as unknown as Prisma.InputJsonValue) : Prisma.DbNull },
        }),
    );
    return toNoteView(note);
  }

  // An edit of a note's page, day, kind or words, or of its highlights. New
  // words without new highlights drop the old ones (their places moved).
  async updateNote(userId: string, bookId: string, noteId: string, dto: UpdateBookNoteDto): Promise<BookNoteView> {
    const note = await this.prisma.bookNote.findFirst({ where: { id: noteId, bookId, book: { userId } }, include: { book: { select: { totalPages: true } } } });
    if (!note) throw new NotFoundException('Note not found');
    const page = dto.page ?? note.page;
    if (dto.page !== undefined && dto.page > note.book.totalPages) throw new BadRequestException(`This book has ${note.book.totalPages} pages`);
    const date = dto.date !== undefined ? pastDay(dto.date, dhakaDateKey(new Date())) : dayKey(note.date);
    const kind = dto.kind ?? note.kind;
    const { line, text } = noteText(kind, dto.line ?? note.line, dto.text ?? note.text);
    const marks = dto.marks !== undefined ? cleanMarks(dto.marks, text) : text === note.text ? storedMarks(note.marks) : null;
    const saved = await this.prisma.bookNote.update({
      where: { id: noteId },
      data: { page, date: asDate(date), kind, line, text, marks: marks?.length ? (marks as unknown as Prisma.InputJsonValue) : Prisma.DbNull },
    });
    return toNoteView(saved);
  }

  async removeNote(userId: string, bookId: string, noteId: string): Promise<{ id: string }> {
    const { count } = await this.prisma.bookNote.deleteMany({ where: { id: noteId, bookId, book: { userId } } });
    if (count === 0) throw new NotFoundException('Note not found');
    return { id: noteId };
  }

  setGoal(userId: string, dto: SetYearlyGoalDto): Promise<YearlyGoal> {
    return setYearlyGoal(dto.target, (year) =>
      this.prisma.bookGoal.upsert({ where: { userId_year: { userId, year } }, update: { target: dto.target }, create: { userId, year, target: dto.target } }),
    );
  }

  clearGoal(userId: string): Promise<YearlyGoal> {
    return clearYearlyGoal((year) => this.prisma.bookGoal.deleteMany({ where: { userId, year } }));
  }

  // A shelf a book may stand on: a built-in one or one of the reader's own.
  private async resolveShelf(userId: string, shelf: string): Promise<string> {
    if ((BOOK_SHELVES as readonly string[]).includes(shelf)) return shelf;
    const own = await this.prisma.bookShelf.findFirst({ where: { id: shelf, userId }, select: { id: true } });
    if (!own) throw new BadRequestException('Pick one of your shelves');
    return own.id;
  }

  private async requireBook(userId: string, id: string): Promise<Book> {
    const book = await this.prisma.book.findFirst({ where: { id, userId } });
    if (!book) throw new NotFoundException('Book not found');
    return book;
  }
}
