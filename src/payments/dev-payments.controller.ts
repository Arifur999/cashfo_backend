import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard.js';
import { SimulatePaymentDto } from './dto/simulate-payment.dto.js';
import { PaymentsService } from './payments.service.js';

// Only registered by PaymentsModule when NODE_ENV !== 'production' (see
// payments.module.ts) -- in production this controller class is never wired
// into the router at all, so the route 404s rather than merely being
// guarded-but-reachable.
@UseGuards(AdminAuthGuard)
@Controller('admin/dev')
export class DevPaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('simulate-payment')
  simulatePayment(@Body() dto: SimulatePaymentDto) {
    return this.paymentsService.simulatePayment(dto);
  }
}
