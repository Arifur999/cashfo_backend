import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Roles } from '../admin-auth/decorators/roles.decorator.js';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard.js';
import { RolesGuard } from '../admin-auth/guards/roles.guard.js';
import { AdminRole } from '../common/roles.js';
import { SimulatePaymentDto } from './dto/simulate-payment.dto.js';
import { PaymentsService } from './payments.service.js';

// Only registered by PaymentsModule when NODE_ENV !== 'production' (see
// payments.module.ts) -- in production this controller class is never wired
// into the router at all, so the route 404s rather than merely being
// guarded-but-reachable.
@UseGuards(AdminAuthGuard, RolesGuard)
@Controller('admin/dev')
export class DevPaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  // Creates payments (and their invoices): the roles that manage payments.
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.FINANCE_ADMIN)
  @Post('simulate-payment')
  simulatePayment(@Body() dto: SimulatePaymentDto) {
    return this.paymentsService.simulatePayment(dto);
  }
}
