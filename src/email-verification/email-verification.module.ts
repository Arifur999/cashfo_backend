import { Module, type OnModuleInit } from '@nestjs/common';
import { HousekeepingScheduler } from '../housekeeping/housekeeping.scheduler.js';
import { MailModule } from '../mail/mail.module.js';
import { EmailVerificationController } from './email-verification.controller.js';
import { EmailVerificationService } from './email-verification.service.js';

const DAY = 24 * 60 * 60 * 1000;

// Email verification links. Deliberately not importing UserAuthModule:
// UserAuthModule imports this one (the first sign-in after signup sends the
// link), and UserAuthGuard's own dependency is global.
@Module({
  imports: [MailModule],
  controllers: [EmailVerificationController],
  providers: [EmailVerificationService],
  exports: [EmailVerificationService],
})
export class EmailVerificationModule implements OnModuleInit {
  constructor(
    private readonly housekeeping: HousekeepingScheduler,
    private readonly service: EmailVerificationService,
  ) {}

  onModuleInit() {
    this.housekeeping.register({ name: 'email-verification-cleanup', everyMs: DAY, run: (now) => this.service.cleanup(now) });
  }
}
