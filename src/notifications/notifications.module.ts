import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { NotificationCampaignsController } from './notification-campaigns.controller.js';
import { NotificationCampaignsService } from './notification-campaigns.service.js';
import { NotificationLogsController } from './notification-logs.controller.js';
import { NotificationLogsService } from './notification-logs.service.js';
import { NotificationTemplatesController } from './notification-templates.controller.js';
import { NotificationTemplatesService } from './notification-templates.service.js';

// Sending is entirely SIMULATED -- see NotificationCampaignsService.send()
// for details. No real email/SMS/push provider (SendGrid, Twilio, a local
// SMS gateway, FCM/APNs, etc.) is wired up; that's production TODO work.
@Module({
  imports: [AdminAuthModule],
  controllers: [NotificationTemplatesController, NotificationLogsController, NotificationCampaignsController],
  providers: [NotificationTemplatesService, NotificationLogsService, NotificationCampaignsService],
})
export class NotificationsModule {}
