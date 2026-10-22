import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Put, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import { UserAuthGuard } from '../user-auth/guards/user-auth.guard.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { ReminderSettingsDto, UpsertReminderDto } from './dto/reminder.dto.js';
import { RemindersService } from './reminders.service.js';

// The Habit Tracker's reminders: set from each habit, challenge, book,
// skill, the Namaz page and Ramadan; the master switch in Settings > App.
@UseGuards(UserAuthGuard)
@Controller('api/reminders')
export class RemindersController {
  constructor(private readonly remindersService: RemindersService) {}

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.remindersService.list(user.id);
  }

  @Put()
  upsert(@CurrentUser() user: RequestUser, @Body() dto: UpsertReminderDto) {
    return this.remindersService.upsert(user.id, dto);
  }

  @Put('settings')
  setSettings(@CurrentUser() user: RequestUser, @Body() dto: ReminderSettingsDto) {
    return this.remindersService.setSettings(user.id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.remindersService.remove(user.id, id);
  }
}
