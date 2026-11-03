import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { UsageEventsService } from '../analytics/usage-events.service.js';
import { USAGE_EVENTS } from '../analytics/usage-events.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { ActiveMonthsQueryDto } from './dto/active-months-query.dto.js';
import { CategoryBreakdownQueryDto } from './dto/category-breakdown-query.dto.js';
import { GeneralLedgerQueryDto } from './dto/general-ledger-query.dto.js';
import { MonthlyBreakdownQueryDto } from './dto/monthly-breakdown-query.dto.js';
import { ReportsService } from './reports.service.js';
import { RequireBusinessMembership } from '../business-access/decorators/require-business-membership.decorator.js';

// No @RequireRole() anywhere in this controller -- viewing reports is open
// to every active member INCLUDING STAFF, per Prompt 7's explicit
// "reports/viewing should generally be more open than data entry" default.
// Only restrict a specific report later if a specific reason comes up.
@RequireBusinessMembership()
@Controller('api/businesses/:businessId')
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly usageEvents: UsageEventsService,
  ) {}

  // Analytics > Feature usage's "report_viewed": once per customer, report
  // and half hour, written in the background (UsageEventsService). The
  // membership guard has put the customer on the request.
  private viewed(req: Request, reportType: string) {
    this.usageEvents.recordFor((req as Request & { user?: RequestUser }).user, req, USAGE_EVENTS.REPORT_VIEWED, { reportType }, reportType);
  }

  @Get('ledger/general')
  generalLedger(@Param('businessId') businessId: string, @Query() query: GeneralLedgerQueryDto, @Req() req: Request) {
    this.viewed(req, 'general_ledger');
    return this.reportsService.getGeneralLedger(businessId, query);
  }

  @Get('reports/trial-balance')
  trialBalance(@Param('businessId') businessId: string, @Req() req: Request) {
    this.viewed(req, 'trial_balance');
    return this.reportsService.getTrialBalance(businessId);
  }

  @Get('reports/category-breakdown')
  categoryBreakdown(@Param('businessId') businessId: string, @Query() query: CategoryBreakdownQueryDto, @Req() req: Request) {
    this.viewed(req, 'category_breakdown');
    return this.reportsService.getCategoryBreakdown(businessId, query);
  }

  @Get('reports/monthly-breakdown')
  monthlyBreakdown(@Param('businessId') businessId: string, @Query() query: MonthlyBreakdownQueryDto, @Req() req: Request) {
    this.viewed(req, 'monthly_breakdown');
    return this.reportsService.getMonthlyBreakdown(businessId, query);
  }

  // The months with anything to show, for a period picker: income and
  // expense (Overview), one account (?accountId=, its ledger) or transfers
  // (?scope=transfers). Not a report view of its own, so no usage event.
  @Get('reports/active-months')
  activeMonths(@Param('businessId') businessId: string, @Query() query: ActiveMonthsQueryDto) {
    return this.reportsService.getActiveMonths(businessId, query);
  }

  @Get('reports/income-vs-savings')
  incomeVsSavings(@Param('businessId') businessId: string, @Req() req: Request, @Query('months') months?: string) {
    this.viewed(req, 'income_vs_savings');
    const parsed = Number(months);
    return this.reportsService.getIncomeVsSavingsTrend(businessId, Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 24) : 6);
  }
}
