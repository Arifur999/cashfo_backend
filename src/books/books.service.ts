import { Injectable, NotFoundException } from '@nestjs/common';
import { BookStatus, type Book } from '@prisma/client';
import { dhakaYear } from '../common/dhaka.js';
import { compareAndSwap, settleShelf, type ShelfItem, type ShelfMessages } from '../common/shelf.js';
import { cleanOptionalText, cleanRequiredText } from '../common/text.js';
import { createWithinCap } from '../common/user-cap.js';
import { clearYearlyGoal, setYearlyGoal, type SetYearlyGoalDto, type YearlyGoal } from '../common/yearly-goal.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateBookDto } from './dto/create-book.dto.js';
import { UpdateBookDto } from './dto/update-book.dto.js';

// Per-user cap, enforced by createWithinCap.
const MAX_BOOKS = 500;

const MAX_TITLE_LENGTH = 120;
const MAX_AUTHOR_LENGTH = 80;

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

const SHELVES = { todo: BookStatus.WANT_TO_READ, doing: BookStatus.READING, done: BookStatus.FINISHED };
const MESSAGES: ShelfMessages = {
  overTotal: "Pages read can't be more than the total pages",
  notStarted: "A book you haven't started can't have pages read",
};

function asShelfItem(book: Book): ShelfItem<BookStatus> {
  return { status: book.status, progress: book.pagesRead, startedAt: book.startedAt, doneAt: book.finishedAt };
}

// The new column values for an edit of `current`. Pure, so it can be re-run on
// a fresh read when a concurrent write is detected.
function buildUpdate(current: Book, dto: UpdateBookDto, now: Date) {
  const title = dto.title !== undefined ? cleanRequiredText(dto.title, 'title', MAX_TITLE_LENGTH) : current.title;
  const author = dto.author !== undefined ? cleanOptionalText(dto.author, 'author', MAX_AUTHOR_LENGTH) : current.author;
  const totalPages = dto.totalPages ?? current.totalPages;
  const shelf = settleShelf(SHELVES, asShelfItem(current), { status: dto.status, progress: dto.pagesRead, total: totalPages }, now, MESSAGES);
  return {
    title,
    author,
    totalPages,
    pagesRead: shelf.progress,
    status: shelf.status,
    color: dto.color ?? current.color,
    startedAt: shelf.startedAt,
    finishedAt: shelf.doneAt,
  };
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
    const title = cleanRequiredText(dto.title, 'title', MAX_TITLE_LENGTH);
    const author = cleanOptionalText(dto.author ?? '', 'author', MAX_AUTHOR_LENGTH);
    const shelf = settleShelf(SHELVES, null, { status: dto.status, progress: dto.pagesRead, total: dto.totalPages }, new Date(), MESSAGES);
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
        pagesRead: shelf.progress,
        status: shelf.status,
        color: dto.color ?? 'walnut',
        startedAt: shelf.startedAt,
            finishedAt: shelf.doneAt,
          },
        }),
    );
    return toView(book);
  }

  // Every column is derived from the row as it was read, so the write only
  // lands if the row is unchanged (see compareAndSwap).
  async update(userId: string, id: string, dto: UpdateBookDto): Promise<BookView> {
    return compareAndSwap(async () => {
      const current = await this.requireBook(userId, id);
      const data = buildUpdate(current, dto, new Date());
      return toView(await this.prisma.book.update({ where: { id, userId, updatedAt: current.updatedAt }, data }));
    }, 'This book was changed elsewhere -- please try again');
  }

  async remove(userId: string, id: string): Promise<{ id: string }> {
    const { count } = await this.prisma.book.deleteMany({ where: { id, userId } });
    if (count === 0) throw new NotFoundException('Book not found');
    return { id };
  }

  setGoal(userId: string, dto: SetYearlyGoalDto): Promise<YearlyGoal> {
    return setYearlyGoal(dto.target, (year) =>
      this.prisma.bookGoal.upsert({ where: { userId_year: { userId, year } }, update: { target: dto.target }, create: { userId, year, target: dto.target } }),
    );
  }

  clearGoal(userId: string): Promise<YearlyGoal> {
    return clearYearlyGoal((year) => this.prisma.bookGoal.deleteMany({ where: { userId, year } }));
  }


  private async requireBook(userId: string, id: string): Promise<Book> {
    const book = await this.prisma.book.findFirst({ where: { id, userId } });
    if (!book) throw new NotFoundException('Book not found');
    return book;
  }
}
