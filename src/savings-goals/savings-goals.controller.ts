import { Body, Controller, Delete, Get, Header, Param, ParseEnumPipe, Patch, Post, Query, StreamableFile } from '@nestjs/common';
import { MemberRole, SavingsGoalStatus } from '@prisma/client';
import { AddContributionDto } from './dto/add-contribution.dto.js';
import { CreateSavingsGoalDto } from './dto/create-savings-goal.dto.js';
import { CreateSavingsTransferDto } from './dto/create-savings-transfer.dto.js';
import { UpdateSavingsGoalDto } from './dto/update-savings-goal.dto.js';
import { UpdateSavingsGoalStatusDto } from './dto/update-savings-goal-status.dto.js';
import { UpdateSavingsPlanDto } from './dto/update-savings-plan.dto.js';
import { WithdrawSavingsGoalDto } from './dto/withdraw-savings-goal.dto.js';
import { WithdrawToBalanceDto } from './dto/withdraw-to-balance.dto.js';
import { SavingsGoalsService } from './savings-goals.service.js';
import { RequireBusinessMembership } from '../business-access/decorators/require-business-membership.decorator.js';
import { RequireRole } from '../business-access/decorators/require-role.decorator.js';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';

// Viewing open to all roles including STAFF; every mutation restricted to
// OWNER/ACCOUNTANT -- same split as every other workspace-scoped
// controller (Budgets, Contacts, Receivables/Payables).
//
// Static segments ('overview', 'account-overview', 'wallet-goals', 'wallets',
// 'transfers', 'transfer')
// are registered before the dynamic ':id' routes in this same controller,
// since Express/Nest would otherwise treat the literal segment as an :id
// value. The Savings Wallet management list itself lives on
// AccountsController (GET .../accounts/savings-wallets) -- a Savings
// Wallet is just a regular Account (accountSubtype "savings"), reusing the
// generic Account CRUD rather than a parallel one here.
@RequireBusinessMembership()
@Controller('api/businesses/:businessId/savings-goals')
export class SavingsGoalsController {
  constructor(private readonly savingsGoalsService: SavingsGoalsService) {}

  @Get()
  list(@Param('businessId') businessId: string, @Query('status', new ParseEnumPipe(SavingsGoalStatus, { optional: true })) status?: SavingsGoalStatus) {
    return this.savingsGoalsService.list(businessId, status);
  }

  @Get('overview')
  getOverview(@Param('businessId') businessId: string) {
    return this.savingsGoalsService.getOverview(businessId);
  }

  @Get('account-overview')
  getAccountOverview(@Param('businessId') businessId: string) {
    return this.savingsGoalsService.getAccountOverview(businessId);
  }

  @Get('wallet-goals')
  listWalletGoals(@Param('businessId') businessId: string) {
    return this.savingsGoalsService.listWalletGoals(businessId);
  }

  @Get('wallets/:accountId/history')
  listWalletHistory(@Param('businessId') businessId: string, @Param('accountId') accountId: string) {
    return this.savingsGoalsService.listWalletHistory(businessId, accountId);
  }

  @Get('transfers')
  listTransfers(@Param('businessId') businessId: string) {
    return this.savingsGoalsService.listTransfers(businessId);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Delete('transfers/:groupId')
  undoTransfer(@Param('businessId') businessId: string, @Param('groupId') groupId: string) {
    return this.savingsGoalsService.undoTransfer(businessId, groupId);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Post('transfer')
  transfer(@Param('businessId') businessId: string, @Body() dto: CreateSavingsTransferDto) {
    return this.savingsGoalsService.transfer(businessId, dto);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Post()
  create(@Param('businessId') businessId: string, @Body() dto: CreateSavingsGoalDto, @CurrentUser() user: RequestUser) {
    return this.savingsGoalsService.create(businessId, dto, user.id);
  }

  @Get(':id')
  getOne(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.savingsGoalsService.getOne(businessId, id);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Patch(':id')
  update(@Param('businessId') businessId: string, @Param('id') id: string, @Body() dto: UpdateSavingsGoalDto, @CurrentUser() user: RequestUser) {
    return this.savingsGoalsService.update(businessId, id, dto, user.id);
  }

  @Get(':id/statement')
  getStatement(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.savingsGoalsService.getStatement(businessId, id);
  }

  @Get(':id/statement.pdf')
  @Header('Cache-Control', 'private, no-store')
  async statementPdf(@Param('businessId') businessId: string, @Param('id') id: string, @CurrentUser() user: RequestUser) {
    const pdf = await this.savingsGoalsService.statementPdf(businessId, id, user.id);
    return new StreamableFile(pdf.data, { type: 'application/pdf', disposition: `attachment; filename="${pdf.fileName}"` });
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Patch(':id/plan')
  updatePlan(@Param('businessId') businessId: string, @Param('id') id: string, @Body() dto: UpdateSavingsPlanDto) {
    return this.savingsGoalsService.updatePlan(businessId, id, dto);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Patch(':id/status')
  updateStatus(@Param('businessId') businessId: string, @Param('id') id: string, @Body() dto: UpdateSavingsGoalStatusDto) {
    return this.savingsGoalsService.updateStatus(businessId, id, dto);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Delete(':id')
  delete(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.savingsGoalsService.delete(businessId, id);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Post(':id/contributions')
  addContribution(@Param('businessId') businessId: string, @Param('id') id: string, @Body() dto: AddContributionDto, @CurrentUser() user: RequestUser) {
    return this.savingsGoalsService.addContribution(businessId, id, dto, user.id);
  }

  // Any amount up to what is saved, to a main balance account.
  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Post(':id/withdrawals')
  withdrawToBalance(@Param('businessId') businessId: string, @Param('id') id: string, @Body() dto: WithdrawToBalanceDto, @CurrentUser() user: RequestUser) {
    return this.savingsGoalsService.withdrawToBalance(businessId, id, dto, user.id);
  }

  // The older whole-amount withdrawal, spent as an expense.
  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Post(':id/withdraw')
  withdraw(@Param('businessId') businessId: string, @Param('id') id: string, @Body() dto: WithdrawSavingsGoalDto, @CurrentUser() user: RequestUser) {
    return this.savingsGoalsService.withdraw(businessId, id, dto, user.id);
  }
}
