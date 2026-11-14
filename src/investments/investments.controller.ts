import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { MemberRole } from '@prisma/client';
import { RequireBusinessMembership } from '../business-access/decorators/require-business-membership.decorator.js';
import { RequireRole } from '../business-access/decorators/require-role.decorator.js';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { CloseInvestmentDto, InvestmentDto, InvestmentEntryDto, UpdateInvestmentEntryDto } from './dto/investment.dto.js';
import { InvestmentsService } from './investments.service.js';

@RequireBusinessMembership()
@Controller('api/businesses/:businessId/investments')
export class InvestmentsController {
  constructor(private readonly investments: InvestmentsService) {}

  @Get()
  list(@Param('businessId') businessId: string) {
    return this.investments.list(businessId);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Post()
  create(@Param('businessId') businessId: string, @Body() dto: InvestmentDto, @CurrentUser() user: RequestUser) {
    return this.investments.create(businessId, dto, user.id);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Patch(':id')
  update(@Param('businessId') businessId: string, @Param('id') id: string, @Body() dto: InvestmentDto, @CurrentUser() user: RequestUser) {
    return this.investments.update(businessId, id, dto, user.id);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Delete(':id')
  remove(@Param('businessId') businessId: string, @Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.investments.remove(businessId, id, user.id);
  }

  // Undo of a delete, for a few minutes after it.
  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Post(':id/restore')
  restore(@Param('businessId') businessId: string, @Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.investments.restore(businessId, id, user.id);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Post(':id/entries')
  addEntry(@Param('businessId') businessId: string, @Param('id') id: string, @Body() dto: InvestmentEntryDto, @CurrentUser() user: RequestUser) {
    return this.investments.addEntry(businessId, id, dto, user.id);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Patch(':id/entries/:entryId')
  updateEntry(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Param('entryId') entryId: string,
    @Body() dto: UpdateInvestmentEntryDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.investments.updateEntry(businessId, id, entryId, dto, user.id);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Delete(':id/entries/:entryId')
  removeEntry(@Param('businessId') businessId: string, @Param('id') id: string, @Param('entryId') entryId: string, @CurrentUser() user: RequestUser) {
    return this.investments.removeEntry(businessId, id, entryId, user.id);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Post(':id/entries/:entryId/restore')
  restoreEntry(@Param('businessId') businessId: string, @Param('id') id: string, @Param('entryId') entryId: string, @CurrentUser() user: RequestUser) {
    return this.investments.restoreEntry(businessId, id, entryId, user.id);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Post(':id/close')
  close(@Param('businessId') businessId: string, @Param('id') id: string, @Body() dto: CloseInvestmentDto, @CurrentUser() user: RequestUser) {
    return this.investments.close(businessId, id, dto, user.id);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Post(':id/undo-close')
  undoClose(@Param('businessId') businessId: string, @Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.investments.undoClose(businessId, id, user.id);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Post(':id/reopen')
  reopen(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.investments.reopen(businessId, id);
  }
}
