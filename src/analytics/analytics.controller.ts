import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard.js';
import { AnalyticsService } from './analytics.service.js';
import { DateRangeQueryDto, EngagementQueryDto } from './dto/date-range-query.dto.js';
import { TrackEventDto } from './dto/track-event.dto.js';
import { TrackingApiKeyGuard } from './guards/tracking-api-key.guard.js';

// No class-level guard here on purpose: `track` is called by end-user
// devices (a different auth story, see TrackingApiKeyGuard) while every
// other route is admin-only, so each route declares its own guard instead of
// inheriting one that wouldn't fit both cases.
@Controller('admin/analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @UseGuards(TrackingApiKeyGuard)
  @Post('track')
  track(@Body() dto: TrackEventDto) {
    return this.analyticsService.track(dto);
  }

  @UseGuards(AdminAuthGuard)
  @Get('feature-usage')
  featureUsage(@Query() query: DateRangeQueryDto) {
    return this.analyticsService.featureUsage(query);
  }

  @UseGuards(AdminAuthGuard)
  @Get('engagement')
  engagement(@Query() query: EngagementQueryDto) {
    return this.analyticsService.engagement(query);
  }

  @UseGuards(AdminAuthGuard)
  @Get('cohorts')
  cohorts(@Query() query: DateRangeQueryDto) {
    return this.analyticsService.cohorts(query);
  }

  @UseGuards(AdminAuthGuard)
  @Get('geography')
  geography(@Query() query: DateRangeQueryDto) {
    return this.analyticsService.geography(query);
  }

  @UseGuards(AdminAuthGuard)
  @Get('devices')
  devices(@Query() query: DateRangeQueryDto) {
    return this.analyticsService.devices(query);
  }

  // With from/to (the period picker): that period's KPI row; without,
  // the last 30 days as before.
  @UseGuards(AdminAuthGuard)
  @Get('summary')
  summary(@Query() query: DateRangeQueryDto) {
    return query.from || query.to ? this.analyticsService.periodSummary(query) : this.analyticsService.summary();
  }
}
