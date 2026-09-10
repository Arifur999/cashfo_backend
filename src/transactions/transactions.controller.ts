import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { MemberRole } from '@prisma/client';
import { CreateTransactionDto } from './dto/create-transaction.dto.js';
import { ListTransactionsQueryDto } from './dto/list-transactions-query.dto.js';
import { VoidTransactionDto } from './dto/void-transaction.dto.js';
import { TransactionsService } from './transactions.service.js';
import { RequireBusinessMembership } from '../business-access/decorators/require-business-membership.decorator.js';
import { RequireRole } from '../business-access/decorators/require-role.decorator.js';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';

// This is the low-level/advanced endpoint (raw journal entries) --
// Prompt 6 builds friendlier POST /income, POST /expense wrappers on top of
// createTransaction() rather than duplicating its validation.
@RequireBusinessMembership()
@Controller('api/businesses/:businessId/transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Get()
  list(@Param('businessId') businessId: string, @Query() query: ListTransactionsQueryDto) {
    return this.transactionsService.listTransactions(businessId, query);
  }

  @Get(':id')
  getOne(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.transactionsService.getTransaction(businessId, id);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Post()
  create(@Param('businessId') businessId: string, @Body() dto: CreateTransactionDto, @CurrentUser() user: RequestUser) {
    return this.transactionsService.createTransaction(businessId, dto, user.id);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Post(':id/void')
  void(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() dto: VoidTransactionDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.transactionsService.voidTransaction(businessId, id, dto.reason, user.id);
  }
}
