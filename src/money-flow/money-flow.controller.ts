import { Controller, Get, Param, Query } from '@nestjs/common';
import { RequireBusinessMembership } from '../business-access/decorators/require-business-membership.decorator.js';
import { MoneyFlowQueryDto } from './dto/money-flow-query.dto.js';
import { MoneyFlowService } from './money-flow.service.js';

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
