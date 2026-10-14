import { Body, Controller, Get, Post, Req, UseFilters, UseGuards } from '@nestjs/common';
import { ChangePasswordDto } from '../user-auth/dto/change-password.dto.js';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AdminAuthService } from './admin-auth.service.js';
import { CurrentAdmin } from './decorators/current-admin.decorator.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshDto } from './dto/refresh.dto.js';
import { AdminAuthGuard } from './guards/admin-auth.guard.js';
import { LoginRateLimitFilter } from './filters/login-rate-limit.filter.js';
import type { RequestAdminUser } from './interfaces/request-admin-user.interface.js';

@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  // Overrides the app-wide default throttler limit with a stricter one:
  // max 5 attempts per 15 minutes per IP.
  @Throttle({ default: { limit: 5, ttl: 15 * 60 * 1000 } })
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
}
