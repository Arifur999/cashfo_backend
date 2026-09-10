import { Body, Controller, Param, Post } from '@nestjs/common';
import { MemberRole } from '@prisma/client';
import { CreateExpenseDto } from './dto/create-expense.dto.js';
import { CreateIncomeDto } from './dto/create-income.dto.js';
import { CreateTransferDto } from './dto/create-transfer.dto.js';
import { QuickEntriesService } from './quick-entries.service.js';
import { RequireBusinessMembership } from '../business-access/decorators/require-business-membership.decorator.js';
import { RequireRole } from '../business-access/decorators/require-role.decorator.js';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';

// Friendly wrappers over TransactionsService (Prompt 5) -- the user-facing
// Income/Expense/Transfer actions. Every route here mutates, so
// OWNER/ACCOUNTANT is required at the class level (consistent with Prompt
// 5's pattern; STAFF can be given entry permission in a future settings
// prompt if desired).
@RequireBusinessMembership()
@RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
@Controller('api/businesses/:businessId')
export class QuickEntriesController {
  constructor(private readonly quickEntriesService: QuickEntriesService) {}

  @Post('income')
  createIncome(@Param('businessId') businessId: string, @Body() dto: CreateIncomeDto, @CurrentUser() user: RequestUser) {
    return this.quickEntriesService.createIncome(businessId, dto, user.id);
  }

  @Post('expense')
  createExpense(@Param('businessId') businessId: string, @Body() dto: CreateExpenseDto, @CurrentUser() user: RequestUser) {
    return this.quickEntriesService.createExpense(businessId, dto, user.id);
  }

  @Post('transfer')
  createTransfer(@Param('businessId') businessId: string, @Body() dto: CreateTransferDto, @CurrentUser() user: RequestUser) {
    return this.quickEntriesService.createTransfer(businessId, dto, user.id);
  }
}
