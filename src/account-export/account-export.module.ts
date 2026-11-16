import { Module } from '@nestjs/common';
import { WritingModule } from '../writing/writing.module.js';
import { AccountExportController } from './account-export.controller.js';
import { AccountExportService } from './account-export.service.js';

// Settings > Resources > Download my data.
@Module({
  // WritingModule: whether the diary is open, for private journal entries.
  imports: [WritingModule],
  controllers: [AccountExportController],
  providers: [AccountExportService],
  // AdminOwnersModule: an admin's "Download a copy" before a reset.
  exports: [AccountExportService],
})
export class AccountExportModule {}
