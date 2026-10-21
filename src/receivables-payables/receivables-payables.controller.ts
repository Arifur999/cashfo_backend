import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { MemberRole } from '@prisma/client';
import { ContactCategoryQueryDto } from './dto/contact-category-query.dto.js';
import { ContactStatementQueryDto } from './dto/contact-statement-query.dto.js';
import { CreatePayableDto } from './dto/create-payable.dto.js';
import { CreateReceivableDto } from './dto/create-receivable.dto.js';
import { DueSoonQueryDto } from './dto/due-soon-query.dto.js';
import { LoanStatementQueryDto } from './dto/loan-statement-query.dto.js';
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

  // Aging, overdue and due-soon take an optional ?category=BUSINESS|LOAN
  // (Books asks for its own contacts, Loan Management for its own); without
  // it every contact counts, as before.
  @Get('receivables/aging')
  receivablesAging(@Param('businessId') businessId: string, @Query() query: ContactCategoryQueryDto) {
    return this.service.getAging(businessId, 'RECEIVABLE', query.category);
  }

  @Get('payables/aging')
  payablesAging(@Param('businessId') businessId: string, @Query() query: ContactCategoryQueryDto) {
    return this.service.getAging(businessId, 'PAYABLE', query.category);
  }

  @Get('receivables/overdue')
  receivablesOverdue(@Param('businessId') businessId: string, @Query() query: ContactCategoryQueryDto) {
    return this.service.getOverdue(businessId, 'RECEIVABLE', query.category);
  }

  @Get('payables/overdue')
  payablesOverdue(@Param('businessId') businessId: string, @Query() query: ContactCategoryQueryDto) {
    return this.service.getOverdue(businessId, 'PAYABLE', query.category);
  }

  @Get('receivables/due-soon')
  receivablesDueSoon(@Param('businessId') businessId: string, @Query() query: DueSoonQueryDto) {
    return this.service.getDueSoon(businessId, 'RECEIVABLE', query.days, query.category);
  }

  @Get('payables/due-soon')
  payablesDueSoon(@Param('businessId') businessId: string, @Query() query: DueSoonQueryDto) {
    return this.service.getDueSoon(businessId, 'PAYABLE', query.days, query.category);
  }

  @Get('loan-management/dashboard')
  loanDashboard(@Param('businessId') businessId: string) {
    return this.service.getLoanDashboard(businessId);
  }

  @Get('contacts/:id/loan-statement')
  loanStatement(@Param('businessId') businessId: string, @Param('id') id: string, @Query() query: LoanStatementQueryDto) {
    return this.service.getLoanStatement(businessId, id, query);
  }

  // Books' customer/supplier statement, paged, with the running balance
  // worked out over the whole history.
  @Get('contacts/:id/statement')
  statement(@Param('businessId') businessId: string, @Param('id') id: string, @Query() query: ContactStatementQueryDto) {
    return this.service.getContactStatement(businessId, id, query);
  }
}
