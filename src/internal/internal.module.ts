import { Module } from '@nestjs/common';
import { InternalController } from './internal.controller.js';

// TEMPORARY -- see internal.controller.ts for why this exists and when to
// remove it.
@Module({
  controllers: [InternalController],
})
export class InternalModule {}
