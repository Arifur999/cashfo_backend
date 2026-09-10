import { Body, Controller, Get, Patch, Post, Req, UseFilters, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshDto } from './dto/refresh.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { UpdateLanguageDto } from './dto/update-language.dto.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { LoginRateLimitFilter } from './filters/login-rate-limit.filter.js';
import { UserAuthGuard } from './guards/user-auth.guard.js';
import type { RequestUser } from './interfaces/request-user.interface.js';
import { UserAuthService } from './user-auth.service.js';

@Controller('api/auth')
export class UserAuthController {
  constructor(private readonly userAuthService: UserAuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.userAuthService.register(dto);
  }

  // Max 5 attempts per 15 minutes per IP, same policy as admin login.
  @Throttle({ default: { limit: 5, ttl: 15 * 60 * 1000 } })
  @UseFilters(LoginRateLimitFilter)
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.userAuthService.login(dto, req.ip, req.headers['user-agent']);
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.userAuthService.refresh(dto.refreshToken);
  }

  @Post('logout')
  logout(@Body() dto: RefreshDto) {
    return this.userAuthService.logout(dto.refreshToken);
  }

  @UseGuards(UserAuthGuard)
  @Get('me')
  me(@CurrentUser() user: RequestUser) {
    return this.userAuthService.me(user.id);
  }

  @UseGuards(UserAuthGuard)
  @Patch('language')
  updateLanguage(@CurrentUser() user: RequestUser, @Body() dto: UpdateLanguageDto) {
    return this.userAuthService.updateLanguage(user.id, dto);
  }

  @UseGuards(UserAuthGuard)
  @Post('change-password')
  changePassword(@CurrentUser() user: RequestUser, @Body() dto: ChangePasswordDto) {
    return this.userAuthService.changePassword(user.id, dto);
  }
}
