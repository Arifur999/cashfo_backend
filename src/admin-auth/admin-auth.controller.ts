import { Body, Controller, Get, Patch, Post, Req, UseFilters, UseGuards } from '@nestjs/common';
import { ChangePasswordDto } from '../user-auth/dto/change-password.dto.js';
import { Throttle } from '@nestjs/throttler';
import { LOGIN_THROTTLE } from '../common/login-throttle.js';
import type { Request } from 'express';
import { AdminAuthService } from './admin-auth.service.js';
import { CurrentAdmin } from './decorators/current-admin.decorator.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshDto } from './dto/refresh.dto.js';
import { UpdateOwnProfileDto } from './dto/update-own-profile.dto.js';
import { AdminAuthGuard } from './guards/admin-auth.guard.js';
import { LoginRateLimitFilter } from './filters/login-rate-limit.filter.js';
import type { RequestAdminUser } from './interfaces/request-admin-user.interface.js';

@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  // 5 attempts per 15 minutes per IP and account, 30 per IP.
  @Throttle(LOGIN_THROTTLE)
  @UseFilters(LoginRateLimitFilter)
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.adminAuthService.login(dto, { ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  }

  // The second half of Google sign-in: the better-auth session cookie the
  // callback left in the browser, forwarded by the frontend, for tokens.
  @Throttle({ default: { limit: 10, ttl: 60 * 1000 } })
  @Post('session/exchange')
  exchangeSession(@Req() req: Request) {
    return this.adminAuthService.exchangeSession(req.headers.cookie, { ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.adminAuthService.refresh(dto.refreshToken);
  }

  @Post('logout')
  logout(@Body() dto: RefreshDto) {
    return this.adminAuthService.logout(dto.refreshToken);
  }

  @Throttle({ default: { limit: 5, ttl: 15 * 60 * 1000 } })
  @UseGuards(AdminAuthGuard)
  @Post('change-password')
  changePassword(@CurrentAdmin() admin: RequestAdminUser, @Body() dto: ChangePasswordDto, @Req() req: Request) {
    return this.adminAuthService.changePassword(admin.id, admin.sessionId, dto, req.ip);
  }

  @UseGuards(AdminAuthGuard)
  @Get('me')
  me(@CurrentAdmin() admin: RequestAdminUser) {
    return this.adminAuthService.me(admin.id);
  }

  // My account: every admin, about themselves only.
  @UseGuards(AdminAuthGuard)
  @Patch('me')
  updateMe(@CurrentAdmin() admin: RequestAdminUser, @Body() dto: UpdateOwnProfileDto, @Req() req: Request) {
    return this.adminAuthService.updateProfile(admin.id, dto, req.ip);
  }

  @UseGuards(AdminAuthGuard)
  @Get('sessions')
  sessions(@CurrentAdmin() admin: RequestAdminUser) {
    return this.adminAuthService.listSessions(admin.id, admin.sessionId);
  }

  @UseGuards(AdminAuthGuard)
  @Post('sessions/sign-out-others')
  signOutOthers(@CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.adminAuthService.signOutOthers(admin.id, admin.sessionId, req.ip);
  }

  @UseGuards(AdminAuthGuard)
  @Get('sign-ins')
  signIns(@CurrentAdmin() admin: RequestAdminUser) {
    return this.adminAuthService.recentSignIns(admin.id);
  }
}
