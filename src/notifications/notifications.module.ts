import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { MailModule } from '../mail/mail.module.js';
import { PushModule } from '../push/push.module.js';
import { NotificationCampaignsController } from './notification-campaigns.controller.js';
import { NotificationCampaignsHousekeeping } from './notification-campaigns.housekeeping.js';
import { NotificationCampaignsService } from './notification-campaigns.service.js';
import { NotificationLogsController } from './notification-logs.controller.js';
import { NotificationLogsService } from './notification-logs.service.js';
import { NotificationTemplatesController } from './notification-templates.controller.js';
import { NotificationTemplatesService } from './notification-templates.service.js';

// Message templates, admin campaigns and their send log. Campaigns go out
// in-app (the customer's bell, plus web push through PushModule) and by
// email (Resend through MailModule); there is no SMS provider yet, so an
// SMS campaign is refused.
@Module({
  imports: [AdminAuthModule, MailModule, PushModule],
  controllers: [NotificationTemplatesController, NotificationLogsController, NotificationCampaignsController],
  providers: [NotificationTemplatesService, NotificationLogsService, NotificationCampaignsService, NotificationCampaignsHousekeeping],
})
export class NotificationsModule {}
