import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import { UserAuthGuard } from '../user-auth/guards/user-auth.guard.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { CreateHabitTrackerDto } from './dto/create-habit-tracker.dto.js';
import { SetHabitTrackerCheckDto } from './dto/set-habit-tracker-check.dto.js';
import { HabitTrackersService } from './habit-trackers.service.js';

// Month-sheet trackers (Namaz's "Create Month" page). Own route prefix
// rather than nesting under api/habits so it can never collide with that
// controller's :id routes. User-scoped like HabitsController -- no
// :businessId.
@UseGuards(UserAuthGuard)
@Controller('api/habit-trackers')
export class HabitTrackersController {
  constructor(private readonly habitTrackersService: HabitTrackersService) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Query('category') category?: string) {
    return this.habitTrackersService.list(user.id, category);
  }

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateHabitTrackerDto) {
    return this.habitTrackersService.create(user.id, dto);
  }

  @Put(':id/check')
  setCheck(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: SetHabitTrackerCheckDto) {
    return this.habitTrackersService.setCheck(user.id, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.habitTrackersService.remove(user.id, id);
  }
}
