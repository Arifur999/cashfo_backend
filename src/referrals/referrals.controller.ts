import { Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import { UserAuthGuard } from '../user-auth/guards/user-auth.guard.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { CreatePayoutMethodDto, UpdatePayoutMethodDto } from './dto/payout-method.dto.js';
import { CreateReferralLinkDto, UpdateReferralLinkDto } from './dto/referral-links.dto.js';
import { EarningsQueryDto, FriendsQueryDto, InviteClickDto, ReferralProfileDto } from './dto/referral-pages.dto.js';
import { ConfirmWithdrawalDto, PageQueryDto, RemindFriendsDto, ResendWithdrawalCodeDto, StartWithdrawalDto } from './dto/withdrawal.dto.js';
import { PayoutMethodsService } from './payout-methods.service.js';
import { ReferralEarningsService } from './referral-earnings.service.js';
import { ReferralFriendsService } from './referral-friends.service.js';
import { ReferralLinksService } from './referral-links.service.js';
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
    private readonly friends: ReferralFriendsService,
    private readonly earnings: ReferralEarningsService,
    private readonly links: ReferralLinksService,
  ) {}

  @Get()
  getInfo(@CurrentUser() user: RequestUser) {
    return this.referralsService.getReferralInfo(user.id);
  }

  // --- Referred users ---

  @Get('friends')
  listFriends(@CurrentUser() user: RequestUser, @Query() query: FriendsQueryDto) {
    return this.friends.list(user.id, query);
  }

  @Get('friends/:id')
  friend(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.friends.detail(user.id, id);
  }

  // --- Earnings: every commission line ---

  @Get('earnings')
  listEarnings(@CurrentUser() user: RequestUser, @Query() query: EarningsQueryDto) {
    return this.earnings.list(user.id, query);
  }

  @Get('earnings/available')
  availableEarnings(@CurrentUser() user: RequestUser) {
    return this.earnings.available(user.id);
  }

  @Get('earnings/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="referral-earnings.csv"')
  @Header('Cache-Control', 'private, no-store')
  exportEarnings(@CurrentUser() user: RequestUser, @Query() query: EarningsQueryDto) {
    return this.earnings.exportCsv(user.id, query);
  }

  // --- Invite links ---

  @Get('links')
  listLinks(@CurrentUser() user: RequestUser) {
    return this.links.list(user.id);
  }

  @Post('links')
  createLink(@CurrentUser() user: RequestUser, @Body() dto: CreateReferralLinkDto) {
    return this.links.create(user.id, dto);
  }

  @Patch('links/:id')
  renameLink(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateReferralLinkDto) {
    return this.links.rename(user.id, id, dto);
  }

  @Delete('links/:id')
  removeLink(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.links.remove(user.id, id);
  }

  // --- Profile & payouts ---

  @Get('profile')
  profile(@CurrentUser() user: RequestUser) {
    return this.referralsService.profile(user.id);
  }

  @Patch('profile')
  updateProfile(@CurrentUser() user: RequestUser, @Body() dto: ReferralProfileDto) {
    return this.referralsService.updateProfile(user.id, dto);
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
  resendCode(@CurrentUser() user: RequestUser, @Param('challengeId') challengeId: string, @Body() dto: ResendWithdrawalCodeDto) {
    return this.withdrawals.resend(user.id, challengeId, dto.byEmail === true);
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
    return this.friends.remind(user.id, dto.referralIds);
  }
}

// No sign-in: the sign-up page shows who invited the visitor
// ("Khaled Mahmud invited you") and the friend's discount.
@Controller('api/referrals/invite')
export class ReferralInviteController {
  constructor(
    private readonly referralsService: ReferralsService,
    private readonly links: ReferralLinksService,
  ) {}

  @Throttle({ default: { limit: 30, ttl: 60 * 1000 } })
  @Get(':code')
  invite(@Param('code') code: string) {
    return this.referralsService.invite(code);
  }

  // The sign-up page counts an open of the link, once per visitor session.
  @Throttle({ default: { limit: 30, ttl: 60 * 1000 } })
  @Post(':code/click')
  @HttpCode(204)
  async click(@Param('code') code: string, @Body() dto: InviteClickDto) {
    await this.links.click(code, dto.src);
  }
}
