import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import { UserAuthGuard } from '../user-auth/guards/user-auth.guard.js';
import { SetYearlyGoalDto } from '../common/yearly-goal.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { BooksService } from './books.service.js';
import { BookYearQueryDto } from './dto/book-year.dto.js';
import { CreateBookDto } from './dto/create-book.dto.js';
import { CreateBookNoteDto } from './dto/create-book-note.dto.js';
import { UpdateBookDto } from './dto/update-book.dto.js';

// Habit Tracker -> Book. User-scoped like HabitsController (no :businessId).
@UseGuards(UserAuthGuard)
@Controller('api/books')
export class BooksController {
  constructor(private readonly booksService: BooksService) {}

  // The whole first page in one call: the current year, its goal, every book.
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

  @Put('goal')
  setGoal(@CurrentUser() user: RequestUser, @Body() dto: SetYearlyGoalDto) {
    return this.booksService.setGoal(user.id, dto);
  }

  @Delete('goal')
  clearGoal(@CurrentUser() user: RequestUser) {
    return this.booksService.clearGoal(user.id);
  }

  @Patch(':id')
  update(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBookDto) {
    return this.booksService.update(user.id, id, dto);
  }

  @Post(':id/notes')
  addNote(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateBookNoteDto) {
    return this.booksService.addNote(user.id, id, dto);
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
