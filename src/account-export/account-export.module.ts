import { Module } from '@nestjs/common';
import { AccountExportController } from './account-export.controller.js';
import { AccountExportService } from './account-export.service.js';

// Settings > Resources > Download my data.
@Module({
  controllers: [AccountExportController],
  providers: [AccountExportService],
  // AdminOwnersModule: an admin's "Download a copy" before a reset.
  exports: [AccountExportService],
})
export class AccountExportModule {}
