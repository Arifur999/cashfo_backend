import { Controller, Get, Param, Query } from '@nestjs/common';
import { MemberRole } from '@prisma/client';
import { CurrentBusinessMember } from '../business-access/decorators/current-business-member.decorator.js';
import { RequireBusinessMembership } from '../business-access/decorators/require-business-membership.decorator.js';
import type { RequestBusinessMember } from '../business-access/interfaces/request-business-member.interface.js';
import { MoneyFlowQueryDto } from './dto/money-flow-query.dto.js';
import { MoneyFlowService } from './money-flow.service.js';
import { PeriodReportService } from './period-report.service.js';

// The dashboard's Cash flow for a period, for anyone in the workspace who
// can see its money (as the reports).
@RequireBusinessMembership()
@Controller('api/businesses/:businessId/money-flow')
export class MoneyFlowController {
  constructor(private readonly moneyFlow: MoneyFlowService) {}

  @Get()
  flow(@Param('businessId') businessId: string, @Query() query: MoneyFlowQueryDto) {
    return this.moneyFlow.flow(businessId, query.dateFrom, query.dateTo);
  }
}

// Reports' page for a period: the net worth statement, the cash flow, and
// the period's savings, loans, assets and events. Events only for the
// owner and accountant, as the events API itself (EventsController).
@RequireBusinessMembership()
@Controller('api/businesses/:businessId/period-report')
export class PeriodReportController {
  constructor(private readonly periodReport: PeriodReportService) {}

  @Get()
  report(@Param('businessId') businessId: string, @Query() query: MoneyFlowQueryDto, @CurrentBusinessMember() member: RequestBusinessMember) {
    const withEvents = member.role === MemberRole.OWNER || member.role === MemberRole.ACCOUNTANT;
    return this.periodReport.report(businessId, query.dateFrom, query.dateTo, new Date(), withEvents);
  }
}
