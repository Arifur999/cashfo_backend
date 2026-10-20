import { Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator.js';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard.js';
import { RolesGuard } from '../admin-auth/guards/roles.guard.js';
import type { RequestAdminUser } from '../admin-auth/interfaces/request-admin-user.interface.js';
import { AdminFeedService } from './admin-feed.service.js';
import { AdminSearchService } from './admin-search.service.js';
import { AdminSearchQueryDto } from './dto/admin-search-query.dto.js';

// The admin top bar: the bell's feed (each admin sees their role's part)
// and the Ctrl K search, which every admin may use, as every admin may read.
@UseGuards(AdminAuthGuard, RolesGuard)
@Controller('admin')
export class AdminFeedController {
  constructor(
    private readonly feedService: AdminFeedService,
    private readonly searchService: AdminSearchService,
  ) {}

  @Get('feed')
  feed(@CurrentAdmin() admin: RequestAdminUser) {
    return this.feedService.feed(admin);
  }

  @Post('feed/seen')
  @HttpCode(200)
  markSeen(@CurrentAdmin() admin: RequestAdminUser) {
    return this.feedService.markSeen(admin.id);
  }

  @Get('search')
  search(@Query() query: AdminSearchQueryDto) {
    return this.searchService.search(query.q);
  }
}
