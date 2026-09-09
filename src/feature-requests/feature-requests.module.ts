import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { FeatureRequestsController } from './feature-requests.controller.js';
import { FeatureRequestsService } from './feature-requests.service.js';

@Module({
  imports: [AdminAuthModule],
  controllers: [FeatureRequestsController],
  providers: [FeatureRequestsService],
})
export class FeatureRequestsModule {}
