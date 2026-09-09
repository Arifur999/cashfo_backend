import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AdminRole } from '@prisma/client';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator.js';
import { Roles } from '../admin-auth/decorators/roles.decorator.js';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard.js';
import { RolesGuard } from '../admin-auth/guards/roles.guard.js';
import type { RequestAdminUser } from '../admin-auth/interfaces/request-admin-user.interface.js';
import { ListPaymentsQueryDto } from './dto/list-payments-query.dto.js';
import { RefundPaymentDto } from './dto/refund-payment.dto.js';
import { PaymentsService } from './payments.service.js';

@UseGuards(AdminAuthGuard, RolesGuard)
@Controller('admin/payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get()
  list(@Query() query: ListPaymentsQueryDto) {
    return this.paymentsService.list(query);
  }

  @Get('failed')
  failed(@Query() query: ListPaymentsQueryDto) {
    return this.paymentsService.failed(query);
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.paymentsService.getById(id);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.FINANCE_ADMIN)
  @Post(':id/retry')
  retry(@Param('id') id: string, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.paymentsService.retry(id, admin.id, req.ip);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.FINANCE_ADMIN)
  @Post(':id/refund')
  refund(
    @Param('id') id: string,
    @Body() dto: RefundPaymentDto,
    @CurrentAdmin() admin: RequestAdminUser,
    @Req() req: Request,
  ) {
    return this.paymentsService.refund(id, dto, admin.id, req.ip);
  }
}
