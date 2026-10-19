import { Module } from '@nestjs/common';
import { SupportController } from './support.controller.js';
import { SupportService } from './support.service.js';

// The customer side of support (Settings > Help). The admin side is
// TicketsModule and FeatureRequestsModule, over the same tables.
@Module({
  controllers: [SupportController],
  providers: [SupportService],
})
export class SupportModule {}
