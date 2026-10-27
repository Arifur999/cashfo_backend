import { Body, Controller, Get, Header, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator.js';
import { Roles } from '../admin-auth/decorators/roles.decorator.js';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard.js';
import { RolesGuard } from '../admin-auth/guards/roles.guard.js';
import type { RequestAdminUser } from '../admin-auth/interfaces/request-admin-user.interface.js';
import { AdminRole } from '../common/roles.js';
import { UpdateReferralSettingsDto } from '../settings/dto/update-referral-settings.dto.js';
import { SettingsService } from '../settings/settings.service.js';
import { AdminReferralsService } from './admin-referrals.service.js';
import { ListPayoutsQueryDto, ListReferralsQueryDto, MarkPayoutPaidDto, ReasonDto } from './dto/admin-referrals.dto.js';

// Admin > Referrals & Payouts. Any admin may read; money and settings
// writes are for super and finance admins, and each is audited.
@UseGuards(AdminAuthGuard, RolesGuard)
@Controller('admin/referrals')
export class AdminReferralsController {
  constructor(
    private readonly service: AdminReferralsService,
    private readonly settingsService: SettingsService,
  ) {}

  // --- Settings ---

  @Get('settings')
  settings() {
    return this.settingsService.getReferralSettingsForAdmin();
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.FINANCE_ADMIN)
  @Patch('settings')
  updateSettings(@Body() dto: UpdateReferralSettingsDto, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.settingsService.updateReferralSettings(dto, admin.id, req.ip);
  }

  // --- Payouts ---

  @Get('payouts')
  payouts(@Query() query: ListPayoutsQueryDto) {
    return this.service.listPayouts(query);
  }

  @Get('payouts/stats')
  payoutStats() {
    return this.service.payoutStats();
  }

  @Get('payouts/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="referral-payouts.csv"')
  @Header('Cache-Control', 'private, no-store')
  exportPayouts(@Query() query: ListPayoutsQueryDto) {
    return this.service.exportPayouts(query);
  }

  @Get('payouts/:id')
  payout(@Param('id') id: string) {
    return this.service.getPayout(id);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.FINANCE_ADMIN)
  @Post('payouts/:id/approve')
  @HttpCode(200)
  approve(@Param('id') id: string, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.service.approve(id, { adminId: admin.id, ipAddress: req.ip });
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.FINANCE_ADMIN)
  @Post('payouts/:id/reject')
  @HttpCode(200)
  reject(@Param('id') id: string, @Body() dto: ReasonDto, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.service.reject(id, dto.reason, { adminId: admin.id, ipAddress: req.ip });
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.FINANCE_ADMIN)
  @Post('payouts/:id/mark-paid')
  @HttpCode(200)
  markPaid(@Param('id') id: string, @Body() dto: MarkPayoutPaidDto, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.service.markPaid(id, dto, { adminId: admin.id, ipAddress: req.ip });
  }

  // --- Every referral ---

  @Get()
  referrals(@Query() query: ListReferralsQueryDto) {
    return this.service.listReferrals(query);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.FINANCE_ADMIN)
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id') id: string, @Body() dto: ReasonDto, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.service.cancelReferral(id, dto.reason, { adminId: admin.id, ipAddress: req.ip });
  }
}
