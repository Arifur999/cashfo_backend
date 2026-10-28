import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { UsageEventsService } from '../analytics/usage-events.service.js';
import { USAGE_EVENTS } from '../analytics/usage-events.js';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import { UserAuthGuard } from '../user-auth/guards/user-auth.guard.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { AddTrackerItemDto } from './dto/add-tracker-item.dto.js';
import { CreateCustomTrackerDto } from './dto/create-custom-tracker.dto.js';
import { CreateHabitTrackerDto } from './dto/create-habit-tracker.dto.js';
import { CreateRamadanTrackerDto } from './dto/create-ramadan-tracker.dto.js';
import { SetHabitTrackerCheckDto } from './dto/set-habit-tracker-check.dto.js';
import { SetRamadanParasDto } from './dto/set-ramadan-paras.dto.js';
import { HabitTrackersService } from './habit-trackers.service.js';

// Month-sheet trackers (Namaz's "Create Month" page, Ramadan's "Create
// Ramadan" page). Own route prefix rather than nesting under api/habits so it
// can never collide with that controller's :id routes. User-scoped like
// HabitsController -- no :businessId.
@UseGuards(UserAuthGuard)
@Controller('api/habit-trackers')
export class HabitTrackersController {
  constructor(
    private readonly habitTrackersService: HabitTrackersService,
    private readonly usageEvents: UsageEventsService,
  ) {}

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

  // Static segment, declared before the :id routes below.
  @Post('custom')
  createCustom(@CurrentUser() user: RequestUser, @Body() dto: CreateCustomTrackerDto) {
    return this.habitTrackersService.createCustom(user.id, dto);
  }

  @Get(':id')
  get(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.habitTrackersService.get(user.id, id);
  }

  @Put(':id/check')
  async setCheck(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetHabitTrackerCheckDto, @Req() req: Request) {
    const result = await this.habitTrackersService.setCheck(user.id, id, dto);
    // Analytics' habit_checked_in, in the background: a tick on a month
    // sheet (Namaz, Ramadan, a challenge), not an untick or a "missed".
    if (dto.checked && dto.status !== 'MISSED') this.usageEvents.recordFor(user, req, USAGE_EVENTS.HABIT_CHECKED_IN, { kind: 'tracker' });
    return result;
  }

  @Put(':id/paras')
  setParas(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetRamadanParasDto) {
    return this.habitTrackersService.setParas(user.id, id, dto);
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
