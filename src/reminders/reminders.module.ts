import { Module } from '@nestjs/common';
import { PushModule } from '../push/push.module.js';
import { UserAuthModule } from '../user-auth/user-auth.module.js';
import { RemindersController } from './reminders.controller.js';
import { RemindersScheduler } from './reminders.scheduler.js';
import { RemindersService } from './reminders.service.js';

// The Habit Tracker's timed reminders: their settings (api/reminders) and
// the scheduler that fires them into the bell and as web pushes.
@Module({
  imports: [UserAuthModule, PushModule],
  controllers: [RemindersController],
  providers: [RemindersService, RemindersScheduler],
})
export class RemindersModule {}
