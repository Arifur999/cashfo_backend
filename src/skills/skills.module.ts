import { Module } from '@nestjs/common';
import { UserAuthModule } from '../user-auth/user-auth.module.js';
import { SkillsController } from './skills.controller.js';
import { SkillsService } from './skills.service.js';

@Module({
  imports: [UserAuthModule],
  controllers: [SkillsController],
  providers: [SkillsService],
})
export class SkillsModule {}
