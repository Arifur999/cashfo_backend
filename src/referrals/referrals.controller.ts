import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { MemberRole } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { RequireBusinessMembership } from '../business-access/decorators/require-business-membership.decorator.js';
import { RequireRole } from '../business-access/decorators/require-role.decorator.js';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import { UserAuthGuard } from '../user-auth/guards/user-auth.guard.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { CreatePayoutMethodDto, UpdatePayoutMethodDto } from './dto/payout-method.dto.js';
import { WithdrawReferralEarningsDto } from './dto/withdraw-referral-earnings.dto.js';
import { ConfirmWithdrawalDto, PageQueryDto, RemindFriendsDto, StartWithdrawalDto } from './dto/withdrawal.dto.js';
import { PayoutMethodsService } from './payout-methods.service.js';
import { ReferralsService } from './referrals.service.js';
import { WithdrawalsService } from './withdrawals.service.js';

// Asking for a code sends an email: a few at a time.
const CODE_THROTTLE = { default: { limit: 10, ttl: 15 * 60 * 1000 } };

// User-scoped: a referral code, its friends, payout methods and
// withdrawals belong to a User, not any one workspace, so these read off
// @CurrentUser() alone. A "View as customer" session only reads
// (UserAuthGuard refuses its writes).
@UseGuards(UserAuthGuard)
@Controller('api/referrals')
export class ReferralsController {
  constructor(
    private readonly referralsService: ReferralsService,
    private readonly methods: PayoutMethodsService,
    private readonly withdrawals: WithdrawalsService,
  ) {}

  @Get()
  getInfo(@CurrentUser() user: RequestUser) {
    return this.referralsService.getReferralInfo(user.id);
  }

  // --- Where the money goes ---

  @Get('payout-methods')
  listMethods(@CurrentUser() user: RequestUser) {
    return this.methods.list(user.id);
  }

  @Post('payout-methods')
  createMethod(@CurrentUser() user: RequestUser, @Body() dto: CreatePayoutMethodDto) {
    return this.methods.create(user.id, dto);
  }

  @Patch('payout-methods/:id')
  updateMethod(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdatePayoutMethodDto) {
    return this.methods.update(user.id, id, dto);
  }

  @Post('payout-methods/:id/default')
  @HttpCode(200)
  makeDefault(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.methods.makeDefault(user.id, id);
  }

  @Delete('payout-methods/:id')
  removeMethod(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.methods.remove(user.id, id);
  }

  // --- Withdrawals: start (a code is sent), confirm with the code ---

  @Throttle(CODE_THROTTLE)
  @Post('withdrawals/start')
  @HttpCode(200)
  startWithdrawal(@CurrentUser() user: RequestUser, @Body() dto: StartWithdrawalDto) {
    return this.withdrawals.start(user.id, dto);
  }

  @Throttle(CODE_THROTTLE)
  @Post('withdrawals/start/:challengeId/resend')
  @HttpCode(200)
  resendCode(@CurrentUser() user: RequestUser, @Param('challengeId') challengeId: string) {
    return this.withdrawals.resend(user.id, challengeId);
  }

  @Throttle({ default: { limit: 20, ttl: 15 * 60 * 1000 } })
  @Post('withdrawals')
  confirmWithdrawal(@CurrentUser() user: RequestUser, @Body() dto: ConfirmWithdrawalDto) {
    return this.withdrawals.confirm(user.id, dto);
  }

  @Get('withdrawals')
  listWithdrawals(@CurrentUser() user: RequestUser, @Query() query: PageQueryDto) {
    return this.withdrawals.list(user.id, query.page ?? 1, query.limit ?? 10);
  }

  @Post('withdrawals/:id/cancel')
  @HttpCode(200)
  cancelWithdrawal(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.withdrawals.cancel(user.id, id);
  }

  // "Send a reminder" to friends who joined but haven't bought.
  @Throttle({ default: { limit: 10, ttl: 60 * 60 * 1000 } })
  @Post('remind')
  @HttpCode(200)
  remind(@CurrentUser() user: RequestUser, @Body() dto: RemindFriendsDto) {
    return this.referralsService.remind(user.id, dto.referralIds);
  }
}

// No sign-in: the sign-up page shows who invited the visitor
// ("Khaled Mahmud invited you") and the friend's discount.
@Controller('api/referrals/invite')
export class ReferralInviteController {
  constructor(private readonly referralsService: ReferralsService) {}

  @Throttle({ default: { limit: 30, ttl: 60 * 1000 } })
  @Get(':code')
  invite(@Param('code') code: string) {
    return this.referralsService.invite(code);
  }
}

// Business-scoped: the old instant withdrawal books the member's available
// old sign-up bonuses as Referral income in one workspace's wallet.
// Commissions go through withdrawals (above) instead.
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
