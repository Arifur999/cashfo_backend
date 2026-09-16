import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { MemberRole } from '@prisma/client';
import { RequireBusinessMembership } from '../business-access/decorators/require-business-membership.decorator.js';
import { RequireRole } from '../business-access/decorators/require-role.decorator.js';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import { UserAuthGuard } from '../user-auth/guards/user-auth.guard.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { WithdrawReferralEarningsDto } from './dto/withdraw-referral-earnings.dto.js';
import { ReferralsService } from './referrals.service.js';

// User-scoped: a referral code/history belongs to a User, not any one
// Business workspace, so this reads off @CurrentUser() alone (no
// :businessId in the route at all).
@UseGuards(UserAuthGuard)
@Controller('api/referrals')
export class ReferralsController {
  constructor(private readonly referralsService: ReferralsService) {}

  @Get()
  getInfo(@CurrentUser() user: RequestUser) {
    return this.referralsService.getReferralInfo(user.id);
  }
}

// Business-scoped: withdrawing needs to target one specific workspace's
// Account (deposit destination) and post a real Transaction into it, so
// this one route lives under :businessId instead, alongside every other
// workspace-scoped controller.
@RequireBusinessMembership()
@Controller('api/businesses/:businessId/referrals')
export class ReferralsWithdrawController {
  constructor(private readonly referralsService: ReferralsService) {}

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Post('withdraw')
  withdraw(@Param('businessId') businessId: string, @Body() dto: WithdrawReferralEarningsDto, @CurrentUser() user: RequestUser) {
    return this.referralsService.withdraw(user.id, businessId, dto.accountId, user.id);
  }
}
