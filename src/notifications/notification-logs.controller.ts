import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard.js';
import { ListNotificationLogsQueryDto } from './dto/list-notification-logs-query.dto.js';
import { NotificationLogsService } from './notification-logs.service.js';

@UseGuards(AdminAuthGuard)
@Controller('admin/notifications/logs')
export class NotificationLogsController {
  constructor(private readonly notificationLogsService: NotificationLogsService) {}

  @Get()
  list(@Query() query: ListNotificationLogsQueryDto) {
    return this.notificationLogsService.list(query);
  }
}
