import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import { UserAuthGuard } from '../user-auth/guards/user-auth.guard.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { CheckInHabitDto } from './dto/check-in-habit.dto.js';
import { CreateHabitDto } from './dto/create-habit.dto.js';
import { UpdateHabitDto } from './dto/update-habit.dto.js';
import { HabitsService } from './habits.service.js';

// User-scoped, like ReferralsController: a habit belongs to a User, not any
// Business workspace, so every route here reads off @CurrentUser() alone --
// no :businessId in the route at all. This is the "Habit Tracker" app-mode
// reached via the end-user app's TopBar "Switch" button.
@UseGuards(UserAuthGuard)
@Controller('api/habits')
export class HabitsController {
  constructor(private readonly habitsService: HabitsService) {}

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
  checkIn(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: CheckInHabitDto) {
    return this.habitsService.checkIn(user.id, id, dto);
  }

  @Delete(':id/check-in')
  removeCheckIn(@CurrentUser() user: RequestUser, @Param('id') id: string, @Query('date') date: string) {
    return this.habitsService.removeCheckIn(user.id, id, date);
  }
}
