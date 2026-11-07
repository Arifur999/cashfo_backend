import { Module } from '@nestjs/common';
import { PushModule } from '../push/push.module.js';
import { EventsController } from './events.controller.js';
import { EventsService } from './events.service.js';

// Calendar & Events: invitations, the customer's own events and the gifts
// at them, with a day-before reminder (the bell, and a push).
@Module({
  imports: [PushModule],
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
