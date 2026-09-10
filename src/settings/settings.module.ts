import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { SettingsController } from './settings.controller.js';
import { SettingsService } from './settings.service.js';

@Module({
  imports: [AdminAuthModule],
  controllers: [SettingsController],
  providers: [SettingsService],
})
export class SettingsModule {}
