import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { CouponsController } from './coupons.controller.js';
import { CouponsService } from './coupons.service.js';

@Module({
  imports: [AdminAuthModule],
  controllers: [CouponsController],
  providers: [CouponsService],
})
export class CouponsModule {}
