import { Module } from '@nestjs/common';
import { SmsService } from './sms.service.js';

// Shared, like MailModule: a feature that sends a text message imports this
// and injects SmsService.
@Module({
  providers: [SmsService],
  exports: [SmsService],
})
export class SmsModule {}
