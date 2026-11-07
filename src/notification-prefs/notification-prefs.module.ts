import { Global, Module } from '@nestjs/common';
import { NotificationPrefsController } from './notification-prefs.controller.js';
import { NotificationPrefsService } from './notification-prefs.service.js';

// Global: every sender (push, the bell's feed) asks it before anything goes out.
@Global()
@Module({
  controllers: [NotificationPrefsController],
  providers: [NotificationPrefsService],
  exports: [NotificationPrefsService],
})
export class NotificationPrefsModule {}
