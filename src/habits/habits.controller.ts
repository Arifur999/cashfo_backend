import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { UsageEventsService } from '../analytics/usage-events.service.js';
import { USAGE_EVENTS } from '../analytics/usage-events.js';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import { UserAuthGuard } from '../user-auth/guards/user-auth.guard.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { CheckInHabitDto } from './dto/check-in-habit.dto.js';
import { CreateHabitDto } from './dto/create-habit.dto.js';
import { HabitMonthsQueryDto } from './dto/habit-months.dto.js';
import { UpdateHabitDto } from './dto/update-habit.dto.js';
import { HabitsService } from './habits.service.js';

// User-scoped, like ReferralsController: a habit belongs to a User, not any
// Business workspace, so every route here reads off @CurrentUser() alone --
// no :businessId in the route at all. This is the "Habit Tracker" app-mode
// reached via the end-user app's TopBar "Switch" button.
@UseGuards(UserAuthGuard)
@Controller('api/habits')
export class HabitsController {
  constructor(
    private readonly habitsService: HabitsService,
    private readonly usageEvents: UsageEventsService,
  ) {}

  // Static segments before the dynamic :id route below, same reasoning as
  // every other controller in this codebase (Express would otherwise treat
  // "today"/"stats"/"month" as an :id value).
  @Get('today')
  getToday(@CurrentUser() user: RequestUser) {
    return this.habitsService.getToday(user.id);
  }

  @Get('stats')
  getStats(@CurrentUser() user: RequestUser) {
    return this.habitsService.getStats(user.id);
  }

  @Get('month')
  getMonthLogs(@CurrentUser() user: RequestUser, @Query('month') month: string) {
    return this.habitsService.getMonthLogs(user.id, month);
  }

  // A run of months at once (Daily habits › Monthly report and its month
  // list), at most 24.
  @Get('months')
  getMonthsLogs(@CurrentUser() user: RequestUser, @Query() query: HabitMonthsQueryDto) {
    return this.habitsService.getMonthsLogs(user.id, query.from, query.to);
  }

  @Get()
  list(@CurrentUser() user: RequestUser, @Query('includeArchived') includeArchived?: string, @Query('category') category?: string) {
    return this.habitsService.listHabits(user.id, includeArchived === 'true', category);
  }

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateHabitDto) {
    return this.habitsService.createHabit(user.id, dto);
  }

  @Patch(':id')
  update(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateHabitDto) {
    return this.habitsService.updateHabit(user.id, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.habitsService.deleteHabit(user.id, id);
  }

  @Post(':id/check-in')
  async checkIn(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: CheckInHabitDto, @Req() req: Request) {
    const result = await this.habitsService.checkIn(user.id, id, dto);
    // Analytics' habit_checked_in, in the background; unticking isn't one.
    if (dto.completed !== false) this.usageEvents.recordFor(user, req, USAGE_EVENTS.HABIT_CHECKED_IN, { kind: 'habit' });
    return result;
  }

  @Delete(':id/check-in')
  removeCheckIn(@CurrentUser() user: RequestUser, @Param('id') id: string, @Query('date') date: string) {
    return this.habitsService.removeCheckIn(user.id, id, date);
  }
}
