import { Module } from '@nestjs/common';
import { DataPrivacyController } from './data-privacy.controller.js';
import { DataPrivacyService } from './data-privacy.service.js';

@Module({
  controllers: [DataPrivacyController],
  providers: [DataPrivacyService],
  exports: [DataPrivacyService],
})
export class DataPrivacyModule {}
