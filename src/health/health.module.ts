import { Module } from '@nestjs/common';
import { ApiHealthController } from './api-health.controller.js';
import { HealthController } from './health.controller.js';

@Module({
  controllers: [HealthController, ApiHealthController],
})
export class HealthModule {}
