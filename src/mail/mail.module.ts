import { Module } from '@nestjs/common';
import { MailService } from './mail.service.js';

// Shared/cross-cutting, same shape as UploadsModule -- any feature module
// that needs to send a transactional email imports this rather than
// duplicating Resend-calling logic.
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
