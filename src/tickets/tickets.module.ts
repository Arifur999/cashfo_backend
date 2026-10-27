import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { MailModule } from '../mail/mail.module.js';
import { SavedRepliesService } from './saved-replies.service.js';
import { TicketsController } from './tickets.controller.js';
import { TicketsService } from './tickets.service.js';

@Module({
  imports: [AdminAuthModule, MailModule],
  controllers: [TicketsController],
  providers: [TicketsService, SavedRepliesService],
})
export class TicketsModule {}
