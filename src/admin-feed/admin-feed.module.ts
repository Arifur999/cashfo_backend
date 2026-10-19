import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { AdminFeedController } from './admin-feed.controller.js';
import { AdminFeedService } from './admin-feed.service.js';
import { AdminSearchService } from './admin-search.service.js';

// The admin top bar's bell and search.
@Module({
  imports: [AdminAuthModule],
  controllers: [AdminFeedController],
  providers: [AdminFeedService, AdminSearchService],
})
export class AdminFeedModule {}
