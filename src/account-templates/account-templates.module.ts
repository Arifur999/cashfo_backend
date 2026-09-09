import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { AccountTemplatesController } from './account-templates.controller.js';
import { AccountTemplatesService } from './account-templates.service.js';

@Module({
  imports: [AdminAuthModule],
  controllers: [AccountTemplatesController],
  providers: [AccountTemplatesService],
})
export class AccountTemplatesModule {}
