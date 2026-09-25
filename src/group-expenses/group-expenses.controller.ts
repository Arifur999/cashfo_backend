import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { GroupMemberStatus, MemberRole } from '@prisma/client';
import { CloseSettlementDto } from './dto/close-settlement.dto.js';
import { CreateGroupContributionDto } from './dto/create-group-contribution.dto.js';
import { CreateGroupExpenseCategoryDto } from './dto/create-group-expense-category.dto.js';
import { CreateGroupExpenseDto } from './dto/create-group-expense.dto.js';
import { CreateGroupMemberDto } from './dto/create-group-member.dto.js';
import { CreateGroupMonthBudgetDto } from './dto/create-group-month-budget.dto.js';
import { UpdateGroupContributionDto } from './dto/update-group-contribution.dto.js';
import { UpdateGroupExpenseCategoryDto } from './dto/update-group-expense-category.dto.js';
import { UpdateGroupExpenseDto } from './dto/update-group-expense.dto.js';
import { UpdateGroupMemberDto } from './dto/update-group-member.dto.js';
import { UpdateGroupMonthBudgetDto } from './dto/update-group-month-budget.dto.js';
import { groupMemberPhotoMulterOptions } from './group-member-photo-upload.js';
import { GroupExpensesService } from './group-expenses.service.js';
import { RequireBusinessMembership } from '../business-access/decorators/require-business-membership.decorator.js';
import { RequireRole } from '../business-access/decorators/require-role.decorator.js';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { ImgbbService } from '../uploads/imgbb.service.js';

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
  constructor(
    private readonly groupExpensesService: GroupExpensesService,
    private readonly imgbbService: ImgbbService,
  ) {}

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

  // Same "upload before the record exists" shape as ContactsController's own
  // upload-photo route -- returns a URL for the Add/Edit Member form to
  // include as photoUrl on the actual create/update call.
  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Post('members/upload-photo')
  @UseInterceptors(FileInterceptor('file', groupMemberPhotoMulterOptions))
  async uploadMemberPhoto(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file was uploaded');
    }
    const url = await this.imgbbService.uploadImage(file.buffer, file.originalname);
    return { url };
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
  @Patch('contributions/:id')
  updateContribution(@Param('businessId') businessId: string, @Param('id') id: string, @Body() dto: UpdateGroupContributionDto) {
    return this.groupExpensesService.updateContribution(businessId, id, dto);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Delete('contributions/:id')
  deleteContribution(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.groupExpensesService.deleteContribution(businessId, id);
  }

  // ---- Expense categories ----
  // Registered before 'expenses/:id' below is irrelevant here -- 'categories'
  // and 'categories/:id' are a different path depth than 'expenses/:id', so
  // there's no static-vs-dynamic collision to order around either way.

  @Get('expenses/categories')
  listExpenseCategories(@Param('businessId') businessId: string) {
    return this.groupExpensesService.listExpenseCategories(businessId);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Post('expenses/categories')
  createExpenseCategory(@Param('businessId') businessId: string, @Body() dto: CreateGroupExpenseCategoryDto) {
    return this.groupExpensesService.createExpenseCategory(businessId, dto);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Patch('expenses/categories/:id')
  updateExpenseCategory(@Param('businessId') businessId: string, @Param('id') id: string, @Body() dto: UpdateGroupExpenseCategoryDto) {
    return this.groupExpensesService.updateExpenseCategory(businessId, id, dto);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Delete('expenses/categories/:id')
  deleteExpenseCategory(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.groupExpensesService.deleteExpenseCategory(businessId, id);
  }

  // ---- Expenses ----

  @Get('expenses')
  listExpenses(
    @Param('businessId') businessId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('category') category?: string,
  ) {
    return this.groupExpensesService.listExpenses(businessId, { from, to, category });
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Post('expenses')
  createExpense(@Param('businessId') businessId: string, @Body() dto: CreateGroupExpenseDto) {
    return this.groupExpensesService.createExpense(businessId, dto);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Patch('expenses/:id')
  updateExpense(@Param('businessId') businessId: string, @Param('id') id: string, @Body() dto: UpdateGroupExpenseDto) {
    return this.groupExpensesService.updateExpense(businessId, id, dto);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Delete('expenses/:id')
  deleteExpense(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.groupExpensesService.deleteExpense(businessId, id);
  }

  // ---- Month budgets ----
  // Manually maintained (Month + Year + Budget entered by the user, not
  // computed from real expenses) -- see GroupMonthlyBudget's schema
  // comment for why this is a separate, plain record rather than the
  // earlier auto-generated month summary it replaces.

  @Get('month-budgets')
  listMonthBudgets(@Param('businessId') businessId: string) {
    return this.groupExpensesService.listMonthBudgets(businessId);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Post('month-budgets')
  createMonthBudget(@Param('businessId') businessId: string, @Body() dto: CreateGroupMonthBudgetDto) {
    return this.groupExpensesService.createMonthBudget(businessId, dto);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Patch('month-budgets/:id')
  updateMonthBudget(@Param('businessId') businessId: string, @Param('id') id: string, @Body() dto: UpdateGroupMonthBudgetDto) {
    return this.groupExpensesService.updateMonthBudget(businessId, id, dto);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Delete('month-budgets/:id')
  deleteMonthBudget(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.groupExpensesService.deleteMonthBudget(businessId, id);
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
