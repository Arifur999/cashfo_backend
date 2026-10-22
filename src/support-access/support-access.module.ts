import { Module } from '@nestjs/common';
import { SupportAccessController } from './support-access.controller.js';
import { SupportAccessService } from './support-access.service.js';

// The customer's consent codes for "View as customer"; AdminOwnersModule
// checks them before it opens a view.
@Module({
  controllers: [SupportAccessController],
  providers: [SupportAccessService],
  exports: [SupportAccessService],
})
export class SupportAccessModule {}
