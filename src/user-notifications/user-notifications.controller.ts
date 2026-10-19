import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import { UserAuthGuard } from '../user-auth/guards/user-auth.guard.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { UpdateReminderPreferencesDto } from './dto/update-reminder-preferences.dto.js';
import { UserNotificationsService } from './user-notifications.service.js';

// The bell in the customer app's top bar, and Settings > App > Reminders.
@UseGuards(UserAuthGuard)
@Controller('api/notifications')
export class UserNotificationsController {
  constructor(private readonly service: UserNotificationsService) {}

  @Get()
  feed(@CurrentUser() user: RequestUser) {
    return this.service.feed(user.id);
  }

  @Get('preferences')
  preferences(@CurrentUser() user: RequestUser) {
    return this.service.preferences(user.id);
  }

  @Put('preferences')
  setPreferences(@CurrentUser() user: RequestUser, @Body() dto: UpdateReminderPreferencesDto) {
    return this.service.setPreferences(user.id, dto);
  }

  // Declared before ':id/read', which would otherwise take "read-all" as an id.
  @Post('read-all')
  @HttpCode(200)
  markAllRead(@CurrentUser() user: RequestUser) {
    return this.service.markAllRead(user.id);
  }

  @Post(':id/read')
  @HttpCode(200)
  markRead(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.markRead(user.id, id);
  }
}
