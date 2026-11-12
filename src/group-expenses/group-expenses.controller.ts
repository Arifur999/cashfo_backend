import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MemberRole } from '@prisma/client';
import { CloseSettlementDto } from './dto/close-settlement.dto.js';
import { CreateGroupContributionDto } from './dto/create-group-contribution.dto.js';
import { CreateGroupExpenseCategoryDto } from './dto/create-group-expense-category.dto.js';
import { CreateGroupExpenseDto } from './dto/create-group-expense.dto.js';
import { CreateGroupMemberDto } from './dto/create-group-member.dto.js';
import { CreateGroupMonthBudgetDto } from './dto/create-group-month-budget.dto.js';
import { GroupCategorySetupDto } from './dto/group-category-setup.dto.js';
import { ReorderGroupCategoriesDto } from './dto/reorder-group-categories.dto.js';
import { GroupCostSplitDto } from './dto/group-cost-split.dto.js';
import {
  GroupActivityQueryDto,
  GroupCashbookQueryDto,
  ListGroupContributionsQueryDto,
  ListGroupExpensesQueryDto,
  ListGroupMealsQueryDto,
  ListGroupMembersQueryDto,
  SettlementQueryDto,
} from './dto/group-query.dto.js';
import { SetGroupMealsDto } from './dto/group-meal.dto.js';
import { SettleUpDto } from './dto/settle-up.dto.js';
import { CreateGroupCashHandoverDto, UpdateGroupCashHandoverDto } from './dto/group-cash-handover.dto.js';
import { UpdateGroupSettingsDto } from './dto/group-settings.dto.js';
import { UpdateGroupContributionDto } from './dto/update-group-contribution.dto.js';
import { UpdateGroupExpenseCategoryDto } from './dto/update-group-expense-category.dto.js';
import { UpdateGroupExpenseDto } from './dto/update-group-expense.dto.js';
import { UpdateGroupMemberDto } from './dto/update-group-member.dto.js';
import { UpdateGroupMonthBudgetDto } from './dto/update-group-month-budget.dto.js';
import { groupMemberPhotoMulterOptions } from './group-member-photo-upload.js';
import { GroupEditorRules } from './group-editor-rules.js';
import { GroupExpensesService } from './group-expenses.service.js';
import { GroupMemberRoute } from '../business-access/decorators/group-member-route.decorator.js';
import { RequireBusinessMembership } from '../business-access/decorators/require-business-membership.decorator.js';
import { RequireRole } from '../business-access/decorators/require-role.decorator.js';
import { CurrentBusinessMember } from '../business-access/decorators/current-business-member.decorator.js';
import type { RequestBusinessMember } from '../business-access/interfaces/request-business-member.interface.js';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { ImgbbService } from '../uploads/imgbb.service.js';

// Who may do what (Group Expense's roles):
// - every member who can open the group reads it: the owner (Admin), an
//   Editor (ACCOUNTANT) and a Viewer (STAFF);
// - money entries (contributions, payments, expenses, cash handovers) are
//   the owner's and an Editor's, an Editor only in their own name
//   (GroupEditorRules);
// - members, roles and access, categories, budgets, settings, meals and
//   closing a month are the owner's alone.
// @GroupMemberRoute(): a group's Viewers and Editors (and member-portal
// logins) may reach these routes at all.
//
// Each sub-resource (members/contributions/expenses/settlement) has its own
// fixed path prefix, so there's no ':id' collision to worry about the way
// AccountsController/BusinessesController have to order static segments
// before a dynamic one.
@RequireBusinessMembership()
@GroupMemberRoute()
@Controller('api/businesses/:businessId/group')
export class GroupExpensesController {
  constructor(
    private readonly groupExpensesService: GroupExpensesService,
    private readonly imgbbService: ImgbbService,
    private readonly editorRules: GroupEditorRules,
  ) {}

  // An Editor (ACCOUNTANT) works only in their own name; see GroupEditorRules.
  private editor(member: RequestBusinessMember): boolean {
    return member.role === MemberRole.ACCOUNTANT;
  }

  // ---- Members ----

  @Get('members')
  listMembers(@Param('businessId') businessId: string, @Query() query: ListGroupMembersQueryDto, @CurrentBusinessMember() member: RequestBusinessMember) {
    return this.groupExpensesService.listMembers(businessId, query.status, member.role === MemberRole.OWNER);
  }

  @RequireRole(MemberRole.OWNER)
  @Post('members')
  createMember(@Param('businessId') businessId: string, @Body() dto: CreateGroupMemberDto, @CurrentUser() user: RequestUser) {
    return this.groupExpensesService.createMember(businessId, dto, user.id);
  }

  @RequireRole(MemberRole.OWNER)
  @Patch('members/:id')
  updateMember(@Param('businessId') businessId: string, @Param('id') id: string, @Body() dto: UpdateGroupMemberDto, @CurrentUser() user: RequestUser) {
    return this.groupExpensesService.updateMember(businessId, id, dto, user.id);
  }

  @RequireRole(MemberRole.OWNER)
  @Delete('members/:id')
  deleteMember(@Param('businessId') businessId: string, @Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.groupExpensesService.deleteMember(businessId, id, user.id);
  }

  // Members > Cost split: equal, or a percent for each active member.
  @RequireRole(MemberRole.OWNER)
  @Put('cost-split')
  setCostSplit(@Param('businessId') businessId: string, @Body() dto: GroupCostSplitDto, @CurrentUser() user: RequestUser) {
    return this.groupExpensesService.setCostSplit(businessId, dto, user.id);
  }

  // Same "upload before the record exists" shape as ContactsController's own
  // upload-photo route -- returns a URL for the Add/Edit Member form to
  // include as photoUrl on the actual create/update call.
  @RequireRole(MemberRole.OWNER)
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
  listContributions(@Param('businessId') businessId: string, @Query() query: ListGroupContributionsQueryDto) {
    return this.groupExpensesService.listContributions(businessId, query);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Post('contributions')
  async createContribution(
    @Param('businessId') businessId: string,
    @Body() dto: CreateGroupContributionDto,
    @CurrentUser() user: RequestUser,
    @CurrentBusinessMember() member: RequestBusinessMember,
  ) {
    if (this.editor(member)) await this.editorRules.contribution(businessId, user.id, dto);
    return this.groupExpensesService.createContribution(businessId, dto, user.id);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Post('settle-up')
  async settleUp(
    @Param('businessId') businessId: string,
    @Body() dto: SettleUpDto,
    @CurrentUser() user: RequestUser,
    @CurrentBusinessMember() member: RequestBusinessMember,
  ) {
    if (this.editor(member)) await this.editorRules.settleUp(businessId, user.id, dto);
    return this.groupExpensesService.settleUp(businessId, dto, user.id);
  }

  // Undo a settle-up: both its rows go together.
  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Delete('settle-up/:settleGroupId')
  async undoSettleUp(
    @Param('businessId') businessId: string,
    @Param('settleGroupId') settleGroupId: string,
    @CurrentUser() user: RequestUser,
    @CurrentBusinessMember() member: RequestBusinessMember,
  ) {
    if (this.editor(member)) await this.editorRules.settleUpUndo(businessId, user.id, settleGroupId);
    return this.groupExpensesService.undoSettleUp(businessId, settleGroupId, user.id);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Patch('contributions/:id')
  async updateContribution(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() dto: UpdateGroupContributionDto,
    @CurrentUser() user: RequestUser,
    @CurrentBusinessMember() member: RequestBusinessMember,
  ) {
    if (this.editor(member)) await this.editorRules.contributionChange(businessId, user.id, id, dto);
    return this.groupExpensesService.updateContribution(businessId, id, dto, user.id);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Delete('contributions/:id')
  async deleteContribution(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @CurrentBusinessMember() member: RequestBusinessMember,
  ) {
    if (this.editor(member)) await this.editorRules.contributionChange(businessId, user.id, id);
    return this.groupExpensesService.deleteContribution(businessId, id, user.id);
  }

  // ---- Expense categories ----
  // Registered before 'expenses/:id' below is irrelevant here -- 'categories'
  // and 'categories/:id' are a different path depth than 'expenses/:id', so
  // there's no static-vs-dynamic collision to order around either way.

  @Get('expenses/categories')
  listExpenseCategories(@Param('businessId') businessId: string) {
    return this.groupExpensesService.listExpenseCategories(businessId);
  }

  @RequireRole(MemberRole.OWNER)
  @Post('expenses/categories')
  createExpenseCategory(@Param('businessId') businessId: string, @Body() dto: CreateGroupExpenseCategoryDto, @CurrentUser() user: RequestUser) {
    return this.groupExpensesService.createExpenseCategory(businessId, dto, user.id);
  }

  // New group, step 3: the family's own list, once, in place of the defaults.
  @RequireRole(MemberRole.OWNER)
  @Post('expenses/categories/setup')
  setupExpenseCategories(@Param('businessId') businessId: string, @Body() dto: GroupCategorySetupDto, @CurrentUser() user: RequestUser) {
    return this.groupExpensesService.setupExpenseCategories(businessId, dto, user.id);
  }

  @RequireRole(MemberRole.OWNER)
  @Patch('expenses/categories/:id')
  updateExpenseCategory(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() dto: UpdateGroupExpenseCategoryDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.groupExpensesService.updateExpenseCategory(businessId, id, dto, user.id);
  }

  // The Categories page's drag handle: every category, in its new order.
  @RequireRole(MemberRole.OWNER)
  @Put('expenses/categories/order')
  reorderExpenseCategories(@Param('businessId') businessId: string, @Body() dto: ReorderGroupCategoriesDto, @CurrentUser() user: RequestUser) {
    return this.groupExpensesService.reorderExpenseCategories(businessId, dto.ids, user.id);
  }

  @RequireRole(MemberRole.OWNER)
  @Delete('expenses/categories/:id')
  deleteExpenseCategory(@Param('businessId') businessId: string, @Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.groupExpensesService.deleteExpenseCategory(businessId, id, user.id);
  }

  // ---- Expenses ----

  @Get('expenses')
  listExpenses(@Param('businessId') businessId: string, @Query() query: ListGroupExpensesQueryDto) {
    return this.groupExpensesService.listExpenses(businessId, query);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Post('expenses')
  async createExpense(
    @Param('businessId') businessId: string,
    @Body() dto: CreateGroupExpenseDto,
    @CurrentUser() user: RequestUser,
    @CurrentBusinessMember() member: RequestBusinessMember,
  ) {
    if (this.editor(member)) await this.editorRules.expense(businessId, user.id, dto);
    return this.groupExpensesService.createExpense(businessId, dto, user.id);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Patch('expenses/:id')
  async updateExpense(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() dto: UpdateGroupExpenseDto,
    @CurrentUser() user: RequestUser,
    @CurrentBusinessMember() member: RequestBusinessMember,
  ) {
    if (this.editor(member)) await this.editorRules.expenseChange(businessId, user.id, id, dto);
    return this.groupExpensesService.updateExpense(businessId, id, dto, user.id);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Delete('expenses/:id')
  async deleteExpense(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @CurrentBusinessMember() member: RequestBusinessMember,
  ) {
    if (this.editor(member)) await this.editorRules.expenseChange(businessId, user.id, id);
    return this.groupExpensesService.deleteExpense(businessId, id, user.id);
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

  @RequireRole(MemberRole.OWNER)
  @Post('month-budgets')
  createMonthBudget(@Param('businessId') businessId: string, @Body() dto: CreateGroupMonthBudgetDto, @CurrentUser() user: RequestUser) {
    return this.groupExpensesService.createMonthBudget(businessId, dto, user.id);
  }

  @RequireRole(MemberRole.OWNER)
  @Patch('month-budgets/:id')
  updateMonthBudget(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() dto: UpdateGroupMonthBudgetDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.groupExpensesService.updateMonthBudget(businessId, id, dto, user.id);
  }

  @RequireRole(MemberRole.OWNER)
  @Delete('month-budgets/:id')
  deleteMonthBudget(@Param('businessId') businessId: string, @Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.groupExpensesService.deleteMonthBudget(businessId, id, user.id);
  }

  // ---- Settings ----

  // The month picker's spending per group month.
  @Get('month-totals')
  monthTotals(@Param('businessId') businessId: string) {
    return this.groupExpensesService.monthTotals(businessId);
  }

  // How many money entries the group has (Settings' danger zone).
  @Get('entries/count')
  entryCount(@Param('businessId') businessId: string) {
    return this.groupExpensesService.entryCount(businessId);
  }

  @Get('settings')
  getSettings(@Param('businessId') businessId: string) {
    return this.groupExpensesService.getSettings(businessId);
  }

  @RequireRole(MemberRole.OWNER)
  @Put('settings')
  updateSettings(@Param('businessId') businessId: string, @Body() dto: UpdateGroupSettingsDto, @CurrentUser() user: RequestUser) {
    return this.groupExpensesService.updateSettings(businessId, dto, user.id);
  }

  // ---- Meals ----

  @Get('meals')
  listMeals(@Param('businessId') businessId: string, @Query() query: ListGroupMealsQueryDto) {
    return this.groupExpensesService.listMeals(businessId, query);
  }

  @RequireRole(MemberRole.OWNER)
  @Put('meals')
  setMeals(@Param('businessId') businessId: string, @Body() dto: SetGroupMealsDto, @CurrentUser() user: RequestUser) {
    return this.groupExpensesService.setMeals(businessId, dto, user.id);
  }

  // ---- Cash handovers ----

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Post('handovers')
  async createHandover(
    @Param('businessId') businessId: string,
    @Body() dto: CreateGroupCashHandoverDto,
    @CurrentUser() user: RequestUser,
    @CurrentBusinessMember() member: RequestBusinessMember,
  ) {
    if (this.editor(member)) await this.editorRules.handover(businessId, user.id, dto);
    return this.groupExpensesService.createHandover(businessId, dto, user.id);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Patch('handovers/:id')
  async updateHandover(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() dto: UpdateGroupCashHandoverDto,
    @CurrentUser() user: RequestUser,
    @CurrentBusinessMember() member: RequestBusinessMember,
  ) {
    if (this.editor(member)) await this.editorRules.handoverChange(businessId, user.id, id, dto);
    return this.groupExpensesService.updateHandover(businessId, id, dto, user.id);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Delete('handovers/:id')
  async deleteHandover(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @CurrentBusinessMember() member: RequestBusinessMember,
  ) {
    if (this.editor(member)) await this.editorRules.handoverChange(businessId, user.id, id);
    return this.groupExpensesService.deleteHandover(businessId, id, user.id);
  }

  // ---- Cash book ----

  @Get('cashbook')
  getCashbook(@Param('businessId') businessId: string, @Query() query: GroupCashbookQueryDto) {
    return this.groupExpensesService.getCashbook(businessId, query);
  }

  // ---- Activity log ----

  @Get('activity')
  listActivity(@Param('businessId') businessId: string, @Query() query: GroupActivityQueryDto, @CurrentUser() user: RequestUser) {
    return this.groupExpensesService.listActivity(businessId, query, user.id);
  }

  // ---- Settlement ----

  @Get('settlement')
  getSettlement(@Param('businessId') businessId: string, @Query() query: SettlementQueryDto) {
    return this.groupExpensesService.getSettlement(businessId, query.from, query.to);
  }

  @Get('settlement/history')
  listSettlementHistory(@Param('businessId') businessId: string) {
    return this.groupExpensesService.listSettlementHistory(businessId);
  }

  @RequireRole(MemberRole.OWNER)
  @Post('settlement/close')
  closeSettlement(@Param('businessId') businessId: string, @Body() dto: CloseSettlementDto, @CurrentUser() user: RequestUser) {
    return this.groupExpensesService.closeSettlement(businessId, dto, user.id);
  }

  // Reopen the newest closed month.
  @RequireRole(MemberRole.OWNER)
  @Post('settlement/:id/reopen')
  reopenSettlement(@Param('businessId') businessId: string, @Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.groupExpensesService.reopenSettlement(businessId, id, user.id);
  }
}
