import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module.js';
import { SmsModule } from '../sms/sms.module.js';
import { SystemMessagesService } from './system-messages.service.js';

// The automatic messages in an admin's own wording (Notifications >
// Templates). Light on purpose: sign-up, billing and support all import it,
// so it imports nothing of theirs.
@Module({
  imports: [MailModule, SmsModule],
  providers: [SystemMessagesService],
  exports: [SystemMessagesService],
})
export class SystemMessagesModule {}
