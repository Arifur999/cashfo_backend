import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { MemberRole } from '@prisma/client';
import { RequireBusinessMembership } from '../business-access/decorators/require-business-membership.decorator.js';
import { RequireRole } from '../business-access/decorators/require-role.decorator.js';
import { CreateSavingsPlanDto } from './dto/create-savings-plan.dto.js';
import { UpdateSavingsPlanDto } from './dto/update-savings-plan.dto.js';
import { SavingsPlansService } from './savings-plans.service.js';

// Viewing open to every member; changes to OWNER/ACCOUNTANT, as on the
// savings goals.
@RequireBusinessMembership()
@Controller('api/businesses/:businessId/savings-plans')
export class SavingsPlansController {
  constructor(private readonly savingsPlansService: SavingsPlansService) {}

  @Get()
  list(@Param('businessId') businessId: string) {
    return this.savingsPlansService.list(businessId);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Post()
  create(@Param('businessId') businessId: string, @Body() dto: CreateSavingsPlanDto) {
    return this.savingsPlansService.create(businessId, dto);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Patch(':id')
  update(@Param('businessId') businessId: string, @Param('id') id: string, @Body() dto: UpdateSavingsPlanDto) {
    return this.savingsPlansService.update(businessId, id, dto);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Delete(':id')
  delete(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.savingsPlansService.delete(businessId, id);
  }
}
