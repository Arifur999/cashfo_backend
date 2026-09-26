import { Module } from '@nestjs/common';
import { UserAuthModule } from '../user-auth/user-auth.module.js';
import { HabitsController } from './habits.controller.js';
import { HabitsService } from './habits.service.js';

@Module({
  imports: [UserAuthModule],
  controllers: [HabitsController],
  providers: [HabitsService],
})
export class HabitsModule {}
