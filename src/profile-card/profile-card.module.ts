import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module.js';
import { ProfileCardController, PublicProfileCardController } from './profile-card.controller.js';
import { ProfileCardService } from './profile-card.service.js';

// Settings > Profile > Share profile card, and its public page.
@Module({
  // SettingsModule: the friend's discount the invite mentions.
  imports: [SettingsModule],
  controllers: [ProfileCardController, PublicProfileCardController],
  providers: [ProfileCardService],
})
export class ProfileCardModule {}
