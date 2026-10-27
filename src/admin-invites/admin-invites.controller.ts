import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, Req, UseFilters, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator.js';
import { Roles } from '../admin-auth/decorators/roles.decorator.js';
import { LoginRateLimitFilter } from '../admin-auth/filters/login-rate-limit.filter.js';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard.js';
import { RolesGuard } from '../admin-auth/guards/roles.guard.js';
import type { RequestAdminUser } from '../admin-auth/interfaces/request-admin-user.interface.js';
import { LOGIN_THROTTLE } from '../common/login-throttle.js';
import { AdminRole } from '../common/roles.js';
import { ForgotPasswordDto } from '../user-auth/dto/forgot-password.dto.js';
import { AdminInvitesService } from './admin-invites.service.js';
import { AdminPasswordResetService } from './admin-password-reset.service.js';
import { AcceptAdminInviteDto, AdminResetPasswordDto, CreateAdminInviteDto, InviteTokenDto } from './dto/admin-invite.dto.js';

const FIFTEEN_MINUTES = 15 * 60 * 1000;

// Security > Admin team: invites. Super admins only.
@UseGuards(AdminAuthGuard, RolesGuard)
@Roles(AdminRole.SUPER_ADMIN)
@Controller('admin/admins/invites')
export class AdminInvitesController {
  constructor(private readonly invites: AdminInvitesService) {}

  @Post()
  create(@Body() dto: CreateAdminInviteDto, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.invites.create(dto, admin.id, req.ip);
  }

  @Get()
  list() {
    return this.invites.list();
  }

  @Post(':id/resend')
  resend(@Param('id', ParseUUIDPipe) id: string, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.invites.resend(id, admin.id, req.ip);
  }

  @Delete(':id')
  revoke(@Param('id', ParseUUIDPipe) id: string, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.invites.revoke(id, admin.id, req.ip);
  }
}

// The admin pages anyone can open: accepting an invite, and the emailed
// password reset. No token; each is throttled.
@Controller('admin/auth')
export class AdminAccountAccessController {
  constructor(
    private readonly invites: AdminInvitesService,
    private readonly passwordReset: AdminPasswordResetService,
  ) {}

  @Throttle({ default: { limit: 20, ttl: FIFTEEN_MINUTES } })
  @Get('invites/check')
  checkInvite(@Query() dto: InviteTokenDto) {
    return this.invites.check(dto.token);
  }

  @Throttle({ default: { limit: 10, ttl: FIFTEEN_MINUTES } })
  @Post('invites/two-step-secret')
  inviteTwoStepSecret(@Body() dto: InviteTokenDto) {
    return this.invites.twoStepSecret(dto.token);
  }

  @Throttle({ default: { limit: 5, ttl: FIFTEEN_MINUTES } })
  @Post('invites/accept')
  acceptInvite(@Body() dto: AcceptAdminInviteDto, @Req() req: Request) {
    return this.invites.accept(dto, { ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  }

  // The sign-in's own budget: 5 per 15 minutes per IP and email, 30 per IP.
  @Throttle(LOGIN_THROTTLE)
  @UseFilters(LoginRateLimitFilter)
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.passwordReset.forgot(dto.email);
  }

  @Throttle({ default: { limit: 20, ttl: FIFTEEN_MINUTES } })
  @Get('reset-password/check')
  checkReset(@Query() dto: InviteTokenDto) {
    return this.passwordReset.check(dto.token);
  }

  @Throttle({ default: { limit: 5, ttl: FIFTEEN_MINUTES } })
  @Post('reset-password')
  resetPassword(@Body() dto: AdminResetPasswordDto, @Req() req: Request) {
    return this.passwordReset.reset(dto.token, dto.password, req.ip);
  }
}
