import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { MemberRole } from '@prisma/client';
import { RequireBusinessMembership } from '../business-access/decorators/require-business-membership.decorator.js';
import { RequireRole } from '../business-access/decorators/require-role.decorator.js';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { BalanceAdjustmentsService } from './balance-adjustments.service.js';
import { AdjustBalanceDto } from './dto/adjust-balance.dto.js';

// Match real balance, on a workspace's money account. Its owner and
// accountant keep its books, so only they adjust it.
@RequireBusinessMembership()
@Controller('api/businesses/:businessId/accounts')
export class BalanceAdjustmentsController {
  constructor(private readonly adjustments: BalanceAdjustmentsService) {}

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Post(':id/adjust')
  @HttpCode(200)
  adjust(@Param('businessId') businessId: string, @Param('id') id: string, @Body() dto: AdjustBalanceDto, @CurrentUser() user: RequestUser) {
    return this.adjustments.adjust(businessId, id, dto, user.id);
  }
}
