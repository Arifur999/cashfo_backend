import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import { UserAuthGuard } from '../user-auth/guards/user-auth.guard.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { BooksService } from './books.service.js';
import { CreateBookDto } from './dto/create-book.dto.js';
import { SetBookGoalDto } from './dto/set-book-goal.dto.js';
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
  @Put('goal')
  setGoal(@CurrentUser() user: RequestUser, @Body() dto: SetBookGoalDto) {
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

  @Delete(':id')
  remove(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.booksService.remove(user.id, id);
  }
}
