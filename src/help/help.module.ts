import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module.js';
import { AdminHelpController, HelpController } from './help.controller.js';
import { HelpService } from './help.service.js';

@Module({
  imports: [SettingsModule],
  controllers: [HelpController, AdminHelpController],
  providers: [HelpService],
})
export class HelpModule {}
