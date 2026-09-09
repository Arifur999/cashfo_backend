import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { TicketsController } from './tickets.controller.js';
import { TicketsService } from './tickets.service.js';

@Module({
  imports: [AdminAuthModule],
  controllers: [TicketsController],
  providers: [TicketsService],
})
export class TicketsModule {}
