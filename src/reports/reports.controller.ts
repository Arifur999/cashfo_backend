import { Controller, Get, Param, Query } from '@nestjs/common';
import { GeneralLedgerQueryDto } from './dto/general-ledger-query.dto.js';
import { ReportsService } from './reports.service.js';
import { RequireBusinessMembership } from '../business-access/decorators/require-business-membership.decorator.js';

// No @RequireRole() anywhere in this controller -- viewing reports is open
// to every active member INCLUDING STAFF, per Prompt 7's explicit
// "reports/viewing should generally be more open than data entry" default.
// Only restrict a specific report later if a specific reason comes up.
@RequireBusinessMembership()
@Controller('api/businesses/:businessId')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('ledger/general')
  generalLedger(@Param('businessId') businessId: string, @Query() query: GeneralLedgerQueryDto) {
    return this.reportsService.getGeneralLedger(businessId, query);
  }

  @Get('reports/trial-balance')
  trialBalance(@Param('businessId') businessId: string) {
    return this.reportsService.getTrialBalance(businessId);
  }
}
