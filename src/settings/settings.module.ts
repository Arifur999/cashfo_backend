import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { SettingsController } from './settings.controller.js';
import { SettingsService } from './settings.service.js';

@Module({
  imports: [AdminAuthModule],
  controllers: [SettingsController],
  providers: [SettingsService],
  // Exported so ReferralsModule (reads referralRewardAmount) and
  // UserAuthModule (snapshots it onto a new Referral row at registration)
  // can inject SettingsService too -- previously only usable within this
  // module itself.
  exports: [SettingsService],
})
export class SettingsModule {}
