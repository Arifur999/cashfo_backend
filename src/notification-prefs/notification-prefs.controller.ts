import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import { UserAuthGuard } from '../user-auth/guards/user-auth.guard.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { UpdateNotificationPrefsDto } from './dto/update-notification-prefs.dto.js';
import { NotificationPrefsService } from './notification-prefs.service.js';

// Settings › Notifications ("Send a test notification" is the push
// controller's test).
@UseGuards(UserAuthGuard)
@Controller('api/notification-settings')
export class NotificationPrefsController {
  constructor(private readonly prefs: NotificationPrefsService) {}

  @Get()
  page(@CurrentUser() user: RequestUser) {
    return this.prefs.page(user.id);
  }

  @Put()
  update(@CurrentUser() user: RequestUser, @Body() dto: UpdateNotificationPrefsDto) {
    return this.prefs.update(user.id, dto);
  }
}
