import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { BudgetCategoryType, MemberRole } from '@prisma/client';
import { BudgetsService } from './budgets.service.js';
import { BudgetQueryDto } from './dto/budget-query.dto.js';
import { CreateBudgetCategoryDto } from './dto/create-budget-category.dto.js';
import { CreateIncomeGoalDto } from './dto/create-income-goal.dto.js';
import { UpdateBudgetCategoryDto } from './dto/update-budget-category.dto.js';
import { UpdateBudgetTargetDto } from './dto/update-budget-target.dto.js';
import { UpdateIncomeGoalDto } from './dto/update-income-goal.dto.js';
import { RequireBusinessMembership } from '../business-access/decorators/require-business-membership.decorator.js';
import { RequireRole } from '../business-access/decorators/require-role.decorator.js';

// Viewing is open to all roles including STAFF; setting the overall target
// and creating/editing/deleting categories restricted to OWNER/ACCOUNTANT --
// same split as every other workspace-scoped controller.
@RequireBusinessMembership()
@Controller('api/businesses/:businessId/budget')
export class BudgetsController {
  constructor(private readonly budgetsService: BudgetsService) {}

  @Get()
  getOverview(@Param('businessId') businessId: string, @Query() query: BudgetQueryDto) {
    return this.budgetsService.getOverview(businessId, query);
  }

  // Lightweight list (no per-category "spent" aggregate) -- used by the Add
  // Transaction form to offer a business's custom categories (Expense or
  // Income tab) without paying for a full overview computation.
  @Get('categories')
  listCategoryNames(@Param('businessId') businessId: string, @Query('type') type?: string) {
    // Bare @Query('type') isn't run through a validated DTO (unlike
    // BudgetQueryDto above), so normalize by hand rather than trust an
    // arbitrary string reaching Prisma's enum filter.
    return this.budgetsService.listCategoryNames(businessId, type === 'INCOME' ? BudgetCategoryType.INCOME : BudgetCategoryType.EXPENSE);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Patch()
  updateTarget(@Param('businessId') businessId: string, @Body() dto: UpdateBudgetTargetDto) {
    return this.budgetsService.updateTarget(businessId, dto);
  }

  // Monthly Income Goal (/income-goal page) -- a history table, one row per
  // month/year, NOT a single standing value like updateTarget() above.
  @Get('income-goals')
  listIncomeGoals(@Param('businessId') businessId: string) {
    return this.budgetsService.listIncomeGoals(businessId);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Post('income-goals')
  createIncomeGoal(@Param('businessId') businessId: string, @Body() dto: CreateIncomeGoalDto) {
    return this.budgetsService.createIncomeGoal(businessId, dto);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Patch('income-goals/:id')
  updateIncomeGoal(@Param('businessId') businessId: string, @Param('id') id: string, @Body() dto: UpdateIncomeGoalDto) {
    return this.budgetsService.updateIncomeGoal(businessId, id, dto);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Delete('income-goals/:id')
  deleteIncomeGoal(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.budgetsService.deleteIncomeGoal(businessId, id);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Post('categories')
  createCategory(@Param('businessId') businessId: string, @Body() dto: CreateBudgetCategoryDto) {
    return this.budgetsService.createCategory(businessId, dto);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Patch('categories/:id')
  updateCategory(@Param('businessId') businessId: string, @Param('id') id: string, @Body() dto: UpdateBudgetCategoryDto) {
    return this.budgetsService.updateCategory(businessId, id, dto);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Delete('categories/:id')
  deleteCategory(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.budgetsService.deleteCategory(businessId, id);
  }
}
