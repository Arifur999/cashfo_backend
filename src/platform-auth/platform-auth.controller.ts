import { Body, Controller, Get, Post, Req, UseFilters, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshDto } from './dto/refresh.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginRateLimitFilter } from './filters/login-rate-limit.filter.js';
import { PlatformAuthGuard } from './guards/platform-auth.guard.js';
import type { RequestPlatformUser } from './interfaces/request-platform-user.interface.js';
import { PlatformAuthService } from './platform-auth.service.js';

@Controller('auth')
export class PlatformAuthController {
  constructor(private readonly platformAuthService: PlatformAuthService) {}

  @Throttle({ default: { limit: 5, ttl: 15 * 60 * 1000 } })
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.platformAuthService.register(dto);
  }

  // Overrides the app-wide default throttler limit with a stricter one:
  // max 5 attempts per 15 minutes per IP (same policy as admin login).
  @Throttle({ default: { limit: 5, ttl: 15 * 60 * 1000 } })
  @UseFilters(LoginRateLimitFilter)
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.platformAuthService.login(dto, req.ip, req.headers['user-agent']);
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.platformAuthService.refresh(dto.refreshToken);
  }

  @Post('logout')
  logout(@Body() dto: RefreshDto) {
    return this.platformAuthService.logout(dto.refreshToken);
  }

  @UseGuards(PlatformAuthGuard)
  @Get('me')
  me(@CurrentUser() user: RequestPlatformUser) {
    return this.platformAuthService.me(user.id);
  }
}
