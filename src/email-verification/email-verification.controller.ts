import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import { UserAuthGuard } from '../user-auth/guards/user-auth.guard.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { VerifyEmailTokenDto } from './dto/verify-email-token.dto.js';
import { EmailVerificationService } from './email-verification.service.js';

// Settings > Profile > "Send a verification email", and the link's page
// (/verify-email?token=...), which works signed out.
@Controller('api/auth/verify-email')
export class EmailVerificationController {
  constructor(private readonly service: EmailVerificationService) {}

  // A few sends a quarter of an hour: a retry or two, never a mail bomb.
  @Throttle({ default: { limit: 3, ttl: 15 * 60 * 1000 } })
  @UseGuards(UserAuthGuard)
  @Post('send')
  @HttpCode(200)
  send(@CurrentUser() user: RequestUser) {
    return this.service.send(user.id);
  }

  @Throttle({ default: { limit: 20, ttl: 15 * 60 * 1000 } })
  @Get()
  check(@Query() dto: VerifyEmailTokenDto) {
    return this.service.check(dto.token);
  }

  @Throttle({ default: { limit: 10, ttl: 15 * 60 * 1000 } })
  @Post()
  @HttpCode(200)
  verify(@Body() dto: VerifyEmailTokenDto) {
    return this.service.verify(dto.token);
  }
}
