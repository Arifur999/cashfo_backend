import { Body, Controller, Delete, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { ConfirmRecoveryEmailDto, StartRecoveryEmailDto } from './dto/recovery-email.dto.js';
import { UserAuthGuard } from './guards/user-auth.guard.js';
import type { RequestUser } from './interfaces/request-user.interface.js';
import { RecoveryEmailService } from './recovery-email.service.js';

// Settings › Security › Recovery email. A password is checked and codes
// are sent, so only a few tries a minute.
@UseGuards(UserAuthGuard)
@Controller('api/auth/recovery-email')
export class RecoveryEmailController {
  constructor(private readonly recovery: RecoveryEmailService) {}

  @Throttle({ default: { limit: 5, ttl: 60 * 1000 } })
  @Post()
  start(@CurrentUser() user: RequestUser, @Body() dto: StartRecoveryEmailDto) {
    return this.recovery.start(user, dto);
  }

  @Throttle({ default: { limit: 10, ttl: 60 * 1000 } })
  @Post('confirm')
  confirm(@CurrentUser() user: RequestUser, @Body() dto: ConfirmRecoveryEmailDto) {
    return this.recovery.confirm(user.id, dto);
  }

  @Delete()
  remove(@CurrentUser() user: RequestUser) {
    return this.recovery.remove(user.id);
  }
}
