import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { GroupExpenseCategory, GroupMemberStatus, MemberRole } from '@prisma/client';
import { CloseSettlementDto } from './dto/close-settlement.dto.js';
import { CreateGroupContributionDto } from './dto/create-group-contribution.dto.js';
import { CreateGroupExpenseDto } from './dto/create-group-expense.dto.js';
import { CreateGroupMemberDto } from './dto/create-group-member.dto.js';
import { UpdateGroupMemberDto } from './dto/update-group-member.dto.js';
import { GroupExpensesService } from './group-expenses.service.js';
import { RequireBusinessMembership } from '../business-access/decorators/require-business-membership.decorator.js';
import { RequireRole } from '../business-access/decorators/require-role.decorator.js';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';

// Viewing open to all roles including STAFF; every mutation restricted to
// OWNER/ACCOUNTANT -- same split as every other workspace-scoped
// controller. In practice a GROUP workspace only ever has the owner as its
// one BusinessMember (participants never log in -- see GroupMember's
// schema comment), but the guard is still applied for consistency with
// every other feature module.
//
// Each sub-resource (members/contributions/expenses/settlement) has its own
// fixed path prefix, so there's no ':id' collision to worry about the way
// AccountsController/BusinessesController have to order static segments
// before a dynamic one.
@RequireBusinessMembership()
@Controller('api/businesses/:businessId/group')
export class GroupExpensesController {
  constructor(private readonly groupExpensesService: GroupExpensesService) {}

  // ---- Members ----

  @Get('members')
  listMembers(@Param('businessId') businessId: string, @Query('status') status?: GroupMemberStatus) {
    return this.groupExpensesService.listMembers(businessId, status);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Post('members')
  createMember(@Param('businessId') businessId: string, @Body() dto: CreateGroupMemberDto) {
    return this.groupExpensesService.createMember(businessId, dto);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Patch('members/:id')
  updateMember(@Param('businessId') businessId: string, @Param('id') id: string, @Body() dto: UpdateGroupMemberDto) {
    return this.groupExpensesService.updateMember(businessId, id, dto);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Delete('members/:id')
  deleteMember(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.groupExpensesService.deleteMember(businessId, id);
  }

  // ---- Contributions ----

  @Get('contributions')
  listContributions(
    @Param('businessId') businessId: string,
    @Query('groupMemberId') groupMemberId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.groupExpensesService.listContributions(businessId, { groupMemberId, from, to });
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Post('contributions')
  createContribution(@Param('businessId') businessId: string, @Body() dto: CreateGroupContributionDto) {
    return this.groupExpensesService.createContribution(businessId, dto);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Delete('contributions/:id')
  deleteContribution(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.groupExpensesService.deleteContribution(businessId, id);
  }

  // ---- Expenses ----

  @Get('expenses')
  listExpenses(
    @Param('businessId') businessId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('category') category?: GroupExpenseCategory,
  ) {
    return this.groupExpensesService.listExpenses(businessId, { from, to, category });
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Post('expenses')
  createExpense(@Param('businessId') businessId: string, @Body() dto: CreateGroupExpenseDto) {
    return this.groupExpensesService.createExpense(businessId, dto);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Delete('expenses/:id')
  deleteExpense(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.groupExpensesService.deleteExpense(businessId, id);
  }

  // ---- Settlement ----

  @Get('settlement')
  getSettlement(@Param('businessId') businessId: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.groupExpensesService.getSettlement(businessId, from, to);
  }

  @Get('settlement/history')
  listSettlementHistory(@Param('businessId') businessId: string) {
    return this.groupExpensesService.listSettlementHistory(businessId);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Post('settlement/close')
  closeSettlement(@Param('businessId') businessId: string, @Body() dto: CloseSettlementDto, @CurrentUser() user: RequestUser) {
    return this.groupExpensesService.closeSettlement(businessId, dto, user.id);
  }
}
