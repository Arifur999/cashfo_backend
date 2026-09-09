import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { TranslationsController } from './translations.controller.js';
import { TranslationsService } from './translations.service.js';

@Module({
  imports: [AdminAuthModule],
  controllers: [TranslationsController],
  providers: [TranslationsService],
})
export class TranslationsModule {}
