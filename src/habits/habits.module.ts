import { Module } from '@nestjs/common';
import { UserAuthModule } from '../user-auth/user-auth.module.js';
import { HabitTrackersController } from './habit-trackers.controller.js';
import { HabitTrackersService } from './habit-trackers.service.js';
import { HabitsController } from './habits.controller.js';
import { HabitsService } from './habits.service.js';

@Module({
  imports: [UserAuthModule],
  controllers: [HabitsController, HabitTrackersController],
  providers: [HabitsService, HabitTrackersService],
})
export class HabitsModule {}
