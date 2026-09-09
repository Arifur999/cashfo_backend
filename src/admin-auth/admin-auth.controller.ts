import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AdminAuthService } from './admin-auth.service.js';
import { CurrentAdmin } from './decorators/current-admin.decorator.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshDto } from './dto/refresh.dto.js';
import { AdminAuthGuard } from './guards/admin-auth.guard.js';
import type { RequestAdminUser } from './interfaces/request-admin-user.interface.js';

@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  // Overrides the app-wide default throttler limit with a stricter one:
  // max 5 attempts per 15 minutes per IP.
  @Throttle({ default: { limit: 5, ttl: 15 * 60 * 1000 } })
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.adminAuthService.login(dto, req.ip);
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.adminAuthService.refresh(dto.refreshToken);
  }

  @Post('logout')
  logout(@Body() dto: RefreshDto) {
    return this.adminAuthService.logout(dto.refreshToken);
  }

  @UseGuards(AdminAuthGuard)
  @Get('me')
  me(@CurrentAdmin() admin: RequestAdminUser) {
    return this.adminAuthService.me(admin.id);
  }
}
