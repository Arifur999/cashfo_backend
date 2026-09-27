import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BookStatus, type Book } from '@prisma/client';
import { cleanText, INVISIBLE_ONLY } from '../common/text.js';
import { dhakaYear } from '../common/dhaka.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateBookDto } from './dto/create-book.dto.js';
import { SetBookGoalDto } from './dto/set-book-goal.dto.js';
import { UpdateBookDto } from './dto/update-book.dto.js';

// A soft cap: the count and the insert are separate statements, so a burst of
// parallel requests can overshoot it slightly. It only guards against runaway
// data, not against a determined client.
const MAX_BOOKS = 500;

const MAX_TITLE_LENGTH = 120;
const MAX_AUTHOR_LENGTH = 80;

function cleanTitle(value: string): string {
  const title = cleanText(value, 'title', MAX_TITLE_LENGTH);
  if (INVISIBLE_ONLY.test(title)) throw new BadRequestException('A title is required');
  return title;
}

function cleanAuthor(value: string): string {
  const author = cleanText(value, 'author', MAX_AUTHOR_LENGTH);
  return INVISIBLE_ONLY.test(author) ? '' : author;
}

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
  createdAt: string;
  updatedAt: string;
}

export interface BooksOverview {
  year: number; // the current Asia/Dhaka year
  goalTarget: number | null; // this year's "finish N books" goal
  books: BookView[];
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
    createdAt: book.createdAt.toISOString(),
    updatedAt: book.updatedAt.toISOString(),
  };
}

// The shelf a book sits on follows from how far the reader is, unless they
// explicitly moved it (`statusRequested`):
//  - moved to FINISHED            -> all pages read
//  - moved to WANT_TO_READ        -> back to page 0
//  - moved to READING             -> (re)start: a finished book starts over at page 0
//  - otherwise, from the pages: all read -> FINISHED, any read -> READING,
//    none read -> stays where it was (a finished book dropped to 0 is READING).
function settle(status: BookStatus, pagesRead: number, totalPages: number, statusRequested: boolean): { status: BookStatus; pagesRead: number } {
  if (statusRequested) {
    if (status === BookStatus.FINISHED) return { status, pagesRead: totalPages };
    if (status === BookStatus.WANT_TO_READ) return { status, pagesRead: 0 };
    return { status, pagesRead: pagesRead >= totalPages ? 0 : pagesRead };
  }
  if (pagesRead >= totalPages) return { status: BookStatus.FINISHED, pagesRead: totalPages };
  if (pagesRead > 0) return { status: BookStatus.READING, pagesRead };
  return { status: status === BookStatus.FINISHED ? BookStatus.READING : status, pagesRead: 0 };
}

function settleDates(current: Pick<Book, 'status' | 'startedAt' | 'finishedAt'> | null, next: BookStatus, now: Date): { startedAt: Date | null; finishedAt: Date | null } {
  let startedAt = current?.startedAt ?? null;
  if (next === BookStatus.WANT_TO_READ) {
    startedAt = null;
  } else if (startedAt === null || (current?.status === BookStatus.FINISHED && next !== BookStatus.FINISHED)) {
    startedAt = now;
  }
  const finishedAt = next === BookStatus.FINISHED ? (current?.finishedAt ?? now) : null;
  return { startedAt, finishedAt };
}

// The new column values for an edit of `current`. Pure, so it can be re-run on
// a fresh read when a concurrent write is detected.
function buildUpdate(current: Book, dto: UpdateBookDto, now: Date) {
  const title = dto.title !== undefined ? cleanTitle(dto.title) : current.title;
  const author = dto.author !== undefined ? cleanAuthor(dto.author) : current.author;
  const totalPages = dto.totalPages ?? current.totalPages;
  if (dto.pagesRead !== undefined && dto.pagesRead > totalPages) {
    throw new BadRequestException("Pages read can't be more than the total pages");
  }

  // Editing only the details of a finished book (say, correcting its page
  // count) keeps it finished, rather than reopening it at the old page.
  const keepFinished = current.status === BookStatus.FINISHED && dto.pagesRead === undefined && (dto.status === undefined || dto.status === BookStatus.FINISHED);
  const pagesRead = keepFinished ? totalPages : (dto.pagesRead ?? current.pagesRead);

  const statusRequested = dto.status !== undefined && dto.status !== current.status;
  const settled = settle(dto.status ?? current.status, pagesRead, totalPages, statusRequested);
  const dates = settleDates(current, settled.status, now);

  return { title, author, totalPages, pagesRead: settled.pagesRead, status: settled.status, color: dto.color ?? current.color, ...dates };
}

@Injectable()
export class BooksService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(userId: string): Promise<BooksOverview> {
    const year = dhakaYear(new Date());
    // One after the other, not Promise.all: the local dev database (`prisma dev`)
    // drops the connection when two queries run at once (P1017), which made
    // this route fail with a 500 every time.
    const books = await this.prisma.book.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' } });
    const goal = await this.prisma.bookGoal.findUnique({ where: { userId_year: { userId, year } } });
    return { year, goalTarget: goal?.target ?? null, books: books.map(toView) };
  }

  async create(userId: string, dto: CreateBookDto): Promise<BookView> {
    const title = cleanTitle(dto.title);
    const author = cleanAuthor(dto.author ?? '');

    const pagesRead = dto.pagesRead ?? 0;
    if (pagesRead > dto.totalPages) {
      throw new BadRequestException("Pages read can't be more than the total pages");
    }
    if (dto.status === BookStatus.WANT_TO_READ && pagesRead > 0) {
      throw new BadRequestException("A book you haven't started can't have pages read");
    }
    if ((await this.prisma.book.count({ where: { userId } })) >= MAX_BOOKS) {
      throw new BadRequestException(`You can keep up to ${MAX_BOOKS} books`);
    }

    // FINISHED and WANT_TO_READ are explicit shelves; READING (or no status)
    // follows the pages -- so 320 of 320 is a finished book, not a restart.
    const statusRequested = dto.status === BookStatus.FINISHED || dto.status === BookStatus.WANT_TO_READ;
    const settled = settle(dto.status ?? BookStatus.WANT_TO_READ, pagesRead, dto.totalPages, statusRequested);
    const dates = settleDates(null, settled.status, new Date());
    const book = await this.prisma.book.create({
      data: { userId, title, author, totalPages: dto.totalPages, pagesRead: settled.pagesRead, status: settled.status, color: dto.color ?? 'walnut', ...dates },
    });
    return toView(book);
  }

  // Every column is derived from the row as it was read, so the write is a
  // compare-and-swap on updatedAt: if another request changed the book in
  // between, re-read and re-derive instead of overwriting its change with
  // stale values (two tabs, or "+10" racing an edit).
  async update(userId: string, id: string, dto: UpdateBookDto): Promise<BookView> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await this.requireBook(userId, id);
      const data = buildUpdate(current, dto, new Date());
      const { count } = await this.prisma.book.updateMany({ where: { id, userId, updatedAt: current.updatedAt }, data });
      if (count === 1) return toView(await this.requireBook(userId, id));
    }
    throw new ConflictException('This book was changed elsewhere -- please try again');
  }

  async remove(userId: string, id: string): Promise<{ id: string }> {
    const { count } = await this.prisma.book.deleteMany({ where: { id, userId } });
    if (count === 0) throw new NotFoundException('Book not found');
    return { id };
  }

  async setGoal(userId: string, dto: SetBookGoalDto): Promise<{ year: number; goalTarget: number | null }> {
    const year = dhakaYear(new Date());
    await this.prisma.bookGoal.upsert({
      where: { userId_year: { userId, year } },
      update: { target: dto.target },
      create: { userId, year, target: dto.target },
    });
    return { year, goalTarget: dto.target };
  }

  async clearGoal(userId: string): Promise<{ year: number; goalTarget: number | null }> {
    const year = dhakaYear(new Date());
    await this.prisma.bookGoal.deleteMany({ where: { userId, year } });
    return { year, goalTarget: null };
  }

  private async requireBook(userId: string, id: string): Promise<Book> {
    const book = await this.prisma.book.findFirst({ where: { id, userId } });
    if (!book) throw new NotFoundException('Book not found');
    return book;
  }
}
