import { Module } from '@nestjs/common';
import { UserAuthModule } from '../user-auth/user-auth.module.js';
import { PushController } from './push.controller.js';
import { PushService } from './push.service.js';

// Web push to customers' devices; RemindersModule sends through it.
@Module({
  imports: [UserAuthModule],
  controllers: [PushController],
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}
