import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { MemberRole } from '@prisma/client';
import { AccountBalanceService } from './account-balance.service.js';
import { AccountsService } from './accounts.service.js';
import { CreateAccountDto } from './dto/create-account.dto.js';
import { LedgerQueryDto } from './dto/ledger-query.dto.js';
import { SummaryQueryDto } from './dto/summary-query.dto.js';
import { UpdateAccountDto } from './dto/update-account.dto.js';
import { RequireBusinessMembership } from '../business-access/decorators/require-business-membership.decorator.js';
import { RequireRole } from '../business-access/decorators/require-role.decorator.js';

// Every route here is workspace-scoped (:businessId) -- @RequireBusinessMembership()
// covers auth + membership for all of them; @RequireRole() additionally
// restricts the mutating ones to OWNER/ACCOUNTANT (STAFF is view-only, per
// Part C's explicit role requirement).
@RequireBusinessMembership()
@Controller('api/businesses/:businessId/accounts')
export class AccountsController {
  constructor(
    private readonly accountsService: AccountsService,
    private readonly accountBalanceService: AccountBalanceService,
  ) {}

  @Get()
  list(@Param('businessId') businessId: string) {
    return this.accountsService.list(businessId);
  }

  // Filtered pickers for the Income/Expense/Transfer forms (Prompt 6) --
  // registered before GET :id so Express doesn't treat these static
  // segments as an :id value, same reasoning as /businesses/limits in
  // Prompt 3.
  @Get('money-accounts')
  moneyAccounts(@Param('businessId') businessId: string) {
    return this.accountsService.listMoneyAccounts(businessId);
  }

  @Get('income-accounts')
  incomeAccounts(@Param('businessId') businessId: string) {
    return this.accountsService.listIncomeAccounts(businessId);
  }

  @Get('expense-accounts')
  expenseAccounts(@Param('businessId') businessId: string) {
    return this.accountsService.listExpenseAccounts(businessId);
  }

  // Registered before GET :id so Express doesn't need to worry about
  // "reconcile" vs "id" ambiguity -- moot here anyway since this is POST,
  // but kept for the same reason /businesses/limits was ordered carefully
  // in Prompt 3.
  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Post('reconcile')
  reconcile(@Param('businessId') businessId: string) {
    return this.accountBalanceService.reconcileWorkspace(businessId);
  }

  @Get(':id')
  getOne(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.accountsService.getOne(businessId, id);
  }

  @Get(':id/ledger')
  ledger(@Param('businessId') businessId: string, @Param('id') id: string, @Query() query: LedgerQueryDto) {
    return this.accountBalanceService.getLedger(businessId, id, query);
  }

  @Get(':id/summary')
  summary(@Param('businessId') businessId: string, @Param('id') id: string, @Query() query: SummaryQueryDto) {
    return this.accountBalanceService.getAccountSummary(businessId, id, query);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Post()
  create(@Param('businessId') businessId: string, @Body() dto: CreateAccountDto) {
    return this.accountsService.create(businessId, dto);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Patch(':id')
  update(@Param('businessId') businessId: string, @Param('id') id: string, @Body() dto: UpdateAccountDto) {
    return this.accountsService.update(businessId, id, dto);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Patch(':id/archive')
  archive(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.accountsService.archive(businessId, id);
  }
}
