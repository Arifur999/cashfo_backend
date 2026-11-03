import { BadRequestException, Body, Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import { UserAuthGuard } from '../user-auth/guards/user-auth.guard.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { JournalMonthQueryDto, JournalSearchQueryDto, SaveJournalEntryDto, SetDiaryPinDto, UnlockDiaryDto } from './dto/journal.dto.js';
import { CreateNoteCategoryDto, CreateNoteDto, UpdateNoteCategoryDto, UpdateNoteDto } from './dto/notes.dto.js';
import { JOURNAL_UNLOCK_HEADER } from './journal-unlock.service.js';
import { JournalService } from './journal.service.js';
import { NotesService } from './notes.service.js';
import { isCalendarDay } from './writing-text.js';

// Habit Tracker > Write > Notes. User-scoped like the rest of the Habit
// Tracker (no :businessId).
@UseGuards(UserAuthGuard)
@Controller('api/notes')
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Get()
  overview(@CurrentUser() user: RequestUser) {
    return this.notes.overview(user.id);
  }

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateNoteDto) {
    return this.notes.create(user.id, dto);
  }

  @Post('categories')
  createCategory(@CurrentUser() user: RequestUser, @Body() dto: CreateNoteCategoryDto) {
    return this.notes.createCategory(user.id, dto);
  }

  @Patch('categories/:id')
  updateCategory(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateNoteCategoryDto) {
    return this.notes.updateCategory(user.id, id, dto);
  }

  @Delete('categories/:id')
  removeCategory(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.notes.removeCategory(user.id, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateNoteDto) {
    return this.notes.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.notes.remove(user.id, id);
  }
}

// Habit Tracker > Write > Journal. A private entry needs the diary unlock,
// sent in the x-journal-unlock header (POST unlock hands it out).
@UseGuards(UserAuthGuard)
@Controller('api/journal')
export class JournalController {
  constructor(private readonly journal: JournalService) {}

  @Get()
  month(@CurrentUser() user: RequestUser, @Query() query: JournalMonthQueryDto, @Headers(JOURNAL_UNLOCK_HEADER) unlock?: string) {
    return this.journal.month(user, query.month, unlock);
  }

  @Get('search')
  search(@CurrentUser() user: RequestUser, @Query() query: JournalSearchQueryDto, @Headers(JOURNAL_UNLOCK_HEADER) unlock?: string) {
    return this.journal.search(user, query.q, unlock);
  }

  // The Habit Tracker dashboard's card.
  @Get('summary')
  summary(@CurrentUser() user: RequestUser) {
    return this.journal.summary(user.id);
  }

  // A 4-6 digit PIN falls to guessing at the global 100 a minute; the
  // service also counts wrong ones per person.
  @Throttle({ default: { limit: 10, ttl: 15 * 60 * 1000 } })
  @Post('pin')
  setPin(@CurrentUser() user: RequestUser, @Body() dto: SetDiaryPinDto) {
    return this.journal.setPin(user, dto);
  }

  @Throttle({ default: { limit: 10, ttl: 15 * 60 * 1000 } })
  @Post('unlock')
  unlock(@CurrentUser() user: RequestUser, @Body() dto: UnlockDiaryDto) {
    return this.journal.unlock(user, dto.pin);
  }

  @Put(':date')
  save(@CurrentUser() user: RequestUser, @Param('date') date: string, @Body() dto: SaveJournalEntryDto, @Headers(JOURNAL_UNLOCK_HEADER) unlock?: string) {
    if (!isCalendarDay(date)) throw new BadRequestException('date must be YYYY-MM-DD');
    return this.journal.save(user, date, dto, unlock);
  }
}
