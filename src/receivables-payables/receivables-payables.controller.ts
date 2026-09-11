import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { MemberRole } from '@prisma/client';
import { CreatePayableDto } from './dto/create-payable.dto.js';
import { CreateReceivableDto } from './dto/create-receivable.dto.js';
import { PayPaymentDto } from './dto/pay-payment.dto.js';
import { ReceivePaymentDto } from './dto/receive-payment.dto.js';
import { ReceivablesPayablesService } from './receivables-payables.service.js';
import { RequireBusinessMembership } from '../business-access/decorators/require-business-membership.decorator.js';
import { RequireRole } from '../business-access/decorators/require-role.decorator.js';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';

// Viewing (balance-detail, aging, overdue) is open to all roles including
// STAFF; recording sales/purchases/payments is restricted to OWNER/
// ACCOUNTANT -- same split as every other data-entry controller.
@RequireBusinessMembership()
@Controller('api/businesses/:businessId')
export class ReceivablesPayablesController {
  constructor(private readonly service: ReceivablesPayablesService) {}

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Post('receivables')
  recordSale(@Param('businessId') businessId: string, @Body() dto: CreateReceivableDto, @CurrentUser() user: RequestUser) {
    return this.service.recordSale(businessId, dto, user.id);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Post('payables')
  recordPurchase(@Param('businessId') businessId: string, @Body() dto: CreatePayableDto, @CurrentUser() user: RequestUser) {
    return this.service.recordPurchase(businessId, dto, user.id);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Post('payments/receive')
  receivePayment(@Param('businessId') businessId: string, @Body() dto: ReceivePaymentDto, @CurrentUser() user: RequestUser) {
    return this.service.receivePayment(businessId, dto, user.id);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Post('payments/pay')
  payPayment(@Param('businessId') businessId: string, @Body() dto: PayPaymentDto, @CurrentUser() user: RequestUser) {
    return this.service.payPayment(businessId, dto, user.id);
  }

  @Get('contacts/:id/balance-detail')
  balanceDetail(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.service.getContactBalanceDetail(businessId, id);
  }

  @Get('receivables/aging')
  receivablesAging(@Param('businessId') businessId: string) {
    return this.service.getAging(businessId, 'RECEIVABLE');
  }

  @Get('payables/aging')
  payablesAging(@Param('businessId') businessId: string) {
    return this.service.getAging(businessId, 'PAYABLE');
  }

  @Get('receivables/overdue')
  receivablesOverdue(@Param('businessId') businessId: string) {
    return this.service.getOverdue(businessId, 'RECEIVABLE');
  }

  @Get('payables/overdue')
  payablesOverdue(@Param('businessId') businessId: string) {
    return this.service.getOverdue(businessId, 'PAYABLE');
  }
}
