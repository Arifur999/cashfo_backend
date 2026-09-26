import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import { UserAuthGuard } from '../user-auth/guards/user-auth.guard.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { AddTrackerItemDto } from './dto/add-tracker-item.dto.js';
import { CreateHabitTrackerDto } from './dto/create-habit-tracker.dto.js';
import { CreateRamadanTrackerDto } from './dto/create-ramadan-tracker.dto.js';
import { SetHabitTrackerCheckDto } from './dto/set-habit-tracker-check.dto.js';
import { HabitTrackersService } from './habit-trackers.service.js';

// Month-sheet trackers (Namaz's "Create Month" page, Ramadan's "Create
// Ramadan" page). Own route prefix rather than nesting under api/habits so it
// can never collide with that controller's :id routes. User-scoped like
// HabitsController -- no :businessId.
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

  // Static segment, declared before the :id routes below.
  @Post('ramadan')
  createRamadan(@CurrentUser() user: RequestUser, @Body() dto: CreateRamadanTrackerDto) {
    return this.habitTrackersService.createRamadan(user.id, dto);
  }

  @Get(':id')
  get(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.habitTrackersService.get(user.id, id);
  }

  @Put(':id/check')
  setCheck(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetHabitTrackerCheckDto) {
    return this.habitTrackersService.setCheck(user.id, id, dto);
  }

  @Post(':id/items')
  addItem(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AddTrackerItemDto) {
    return this.habitTrackersService.addItem(user.id, id, dto);
  }

  // The habit name goes in the query string (it can contain spaces or
  // slashes, which don't belong in a path segment).
  @Delete(':id/items')
  removeItem(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Query('name') name?: string) {
    if (!name) throw new BadRequestException('name is required');
    return this.habitTrackersService.removeItem(user.id, id, name);
  }

  @Delete(':id')
  remove(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.habitTrackersService.remove(user.id, id);
  }
}
