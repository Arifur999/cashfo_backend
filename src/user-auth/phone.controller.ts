import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { ConfirmCodeDto, PhoneResetConfirmDto, PhoneResetDto, StartPhoneVerifyDto } from './dto/phone.dto.js';
import { UserAuthGuard } from './guards/user-auth.guard.js';
import type { RequestUser } from './interfaces/request-user.interface.js';
import { PhoneService } from './phone.service.js';

const FIFTEEN_MINUTES = 15 * 60 * 1000;

// The customer's phone: proving it by SMS, and "Forgot password" by a
// proved phone. Each send costs an SMS, so the budgets are tight; the code
// service also keeps resends a minute apart, five at most.
@Controller('api/auth/phone')
export class PhoneController {
  constructor(private readonly phone: PhoneService) {}

  // Checks the account password, so it gets the login's budget.
  @Throttle({ default: { limit: 5, ttl: FIFTEEN_MINUTES } })
  @UseGuards(UserAuthGuard)
  @Post('verify/start')
  startVerify(@CurrentUser() user: RequestUser, @Body() dto: StartPhoneVerifyDto) {
    return this.phone.startVerify(user, dto.currentPassword);
  }

  @Throttle({ default: { limit: 5, ttl: FIFTEEN_MINUTES } })
  @UseGuards(UserAuthGuard)
  @Post('verify/start/:challengeId/resend')
  resendVerify(@CurrentUser() user: RequestUser, @Param('challengeId', ParseUUIDPipe) challengeId: string) {
    return this.phone.resendVerify(user.id, challengeId);
  }

  @Throttle({ default: { limit: 10, ttl: FIFTEEN_MINUTES } })
  @UseGuards(UserAuthGuard)
  @Post('verify')
  confirmVerify(@CurrentUser() user: RequestUser, @Body() dto: ConfirmCodeDto) {
    return this.phone.confirmVerify(user.id, dto.challengeId, dto.code);
  }

  @Throttle({ default: { limit: 3, ttl: FIFTEEN_MINUTES } })
  @Post('reset/start')
  startReset(@Body() dto: PhoneResetDto) {
    return this.phone.startReset(dto.phone);
  }

  @Throttle({ default: { limit: 5, ttl: FIFTEEN_MINUTES } })
  @Post('reset/start/:challengeId/resend')
  resendReset(@Param('challengeId', ParseUUIDPipe) challengeId: string, @Body() dto: PhoneResetDto) {
    return this.phone.resendReset(dto.phone, challengeId);
  }

  @Throttle({ default: { limit: 10, ttl: FIFTEEN_MINUTES } })
  @Post('reset')
  confirmReset(@Body() dto: PhoneResetConfirmDto) {
    return this.phone.confirmReset(dto.phone, dto.challengeId, dto.code);
  }
}
