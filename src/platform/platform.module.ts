import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { AnnouncementsModule } from '../announcements/announcements.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { SystemModule } from '../system/system.module.js';
import { MaintenanceMiddleware } from './maintenance.middleware.js';
import { PlatformController } from './platform.controller.js';
import { PlatformService } from './platform.service.js';

@Module({
  imports: [SettingsModule, SystemModule, AnnouncementsModule],
  controllers: [PlatformController],
  providers: [PlatformService],
})
export class PlatformModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Every route; the middleware itself only acts on /api/*.
    consumer.apply(MaintenanceMiddleware).forRoutes({ path: '{*splat}', method: RequestMethod.ALL });
  }
}
