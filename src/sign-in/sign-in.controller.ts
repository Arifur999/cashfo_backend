import { Body, Controller, Post, Req, UseFilters } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { LOGIN_THROTTLE } from '../common/login-throttle.js';
import type { Request } from 'express';
import type { ClientInfo } from '../auth/auth-sessions.service.js';
import { LoginDto } from '../user-auth/dto/login.dto.js';
import { SessionExchangeDto } from '../user-auth/dto/session-exchange.dto.js';
import { LoginRateLimitFilter } from '../user-auth/filters/login-rate-limit.filter.js';
import { SignInService } from './sign-in.service.js';

// req.ip already honours TRUST_PROXY; the frontend forwards the visitor's
// X-Forwarded-For and User-Agent with every call.
const clientOf = (req: Request): ClientInfo => ({ ipAddress: req.ip, userAgent: req.headers['user-agent'] });

@Controller('api/auth')
export class SignInController {
  constructor(private readonly signIn: SignInService) {}

  // Same policy as both side-specific logins: 5 attempts per 15 minutes
  // per IP and account, 30 per IP.
  @Throttle(LOGIN_THROTTLE)
  @UseFilters(LoginRateLimitFilter)
  @Post('sign-in')
  withPassword(@Body() dto: LoginDto, @Req() req: Request) {
    return this.signIn.withPassword(dto, clientOf(req));
  }

  @Throttle({ default: { limit: 10, ttl: 60 * 1000 } })
  @Post('session/sign-in')
  withSession(@Req() req: Request, @Body() dto: SessionExchangeDto) {
    return this.signIn.withSession(req.headers.cookie, clientOf(req), dto.referralCode);
  }
}
