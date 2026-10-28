import { Module, type OnModuleInit } from '@nestjs/common';
import { HousekeepingScheduler } from '../housekeeping/housekeeping.scheduler.js';
import { MailModule } from '../mail/mail.module.js';
import { SmsModule } from '../sms/sms.module.js';
import { OneTimeCodesService } from './one-time-codes.service.js';
import { DevLogOtpSender, EmailOtpSender, OtpSenders, SmsOtpSender } from './otp-senders.js';

const HOUR = 60 * 60 * 1000;

// Six-digit confirmation codes (OneTimeCode) and the channels that send
// them. Used by referral withdrawals; meant for later purposes too.
@Module({
  imports: [MailModule, SmsModule],
  providers: [OneTimeCodesService, OtpSenders, EmailOtpSender, SmsOtpSender, DevLogOtpSender],
  exports: [OneTimeCodesService],
})
export class OneTimeCodesModule implements OnModuleInit {
  constructor(
    private readonly housekeeping: HousekeepingScheduler,
    private readonly codes: OneTimeCodesService,
  ) {}

  onModuleInit() {
    this.housekeeping.register({ name: 'one-time-code-cleanup', everyMs: HOUR, run: (now) => this.codes.cleanup(now) });
  }
}
