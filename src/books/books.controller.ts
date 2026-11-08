import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import { UserAuthGuard } from '../user-auth/guards/user-auth.guard.js';
import { SetYearlyGoalDto } from '../common/yearly-goal.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { BooksService } from './books.service.js';
import { BookPagesQueryDto, BookYearQueryDto } from './dto/book-year.dto.js';
import { CreateBookDto } from './dto/create-book.dto.js';
import { CreateBookNoteDto, UpdateBookNoteDto } from './dto/create-book-note.dto.js';
import { CreateBookShelfDto } from './dto/create-book-shelf.dto.js';
import { LogReadingDto } from './dto/log-reading.dto.js';
import { UpdateBookDto } from './dto/update-book.dto.js';

// Habit Tracker -> Book. User-scoped like HabitsController (no :businessId).
@UseGuards(UserAuthGuard)
@Controller('api/books')
export class BooksController {
  constructor(private readonly booksService: BooksService) {}

  // Reading now and My books in one call: the current year, its goal, every
  // book, the shelves, and the reading and notes those pages show.
  @Get()
  overview(@CurrentUser() user: RequestUser) {
    return this.booksService.overview(user.id);
  }

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateBookDto) {
    return this.booksService.create(user.id, dto);
  }

  // Static segments, declared before the :id routes below.
  // Library › Dashboard: one year's pages, month by month.
  @Get('year')
  year(@CurrentUser() user: RequestUser, @Query() query: BookYearQueryDto) {
    return this.booksService.year(user.id, query.year);
  }

  // Library › Dashboard: the pages read in the period picked.
  @Get('pages')
  pages(@CurrentUser() user: RequestUser, @Query() query: BookPagesQueryDto) {
    return this.booksService.pages(user.id, query.from, query.to);
  }

  @Put('goal')
  setGoal(@CurrentUser() user: RequestUser, @Body() dto: SetYearlyGoalDto) {
    return this.booksService.setGoal(user.id, dto);
  }

  @Delete('goal')
  clearGoal(@CurrentUser() user: RequestUser) {
    return this.booksService.clearGoal(user.id);
  }

  @Post('shelves')
  createShelf(@CurrentUser() user: RequestUser, @Body() dto: CreateBookShelfDto) {
    return this.booksService.createShelf(user.id, dto);
  }

  // The book page: the book with its summary, every note, the shelves.
  @Get(':id')
  detail(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.booksService.detail(user.id, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBookDto) {
    return this.booksService.update(user.id, id, dto);
  }

  // Reading now's "Log today's reading".
  @Post(':id/reading')
  logReading(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LogReadingDto) {
    return this.booksService.logReading(user.id, id, dto);
  }

  @Post(':id/notes')
  addNote(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateBookNoteDto) {
    return this.booksService.addNote(user.id, id, dto);
  }

  @Patch(':id/notes/:noteId')
  updateNote(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Body() dto: UpdateBookNoteDto,
  ) {
    return this.booksService.updateNote(user.id, id, noteId, dto);
  }

  @Delete(':id/notes/:noteId')
  removeNote(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Param('noteId', ParseUUIDPipe) noteId: string) {
    return this.booksService.removeNote(user.id, id, noteId);
  }

  @Delete(':id')
  remove(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.booksService.remove(user.id, id);
  }
}
