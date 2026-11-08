import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { MemberRole } from '@prisma/client';
import { RequireBusinessMembership } from '../business-access/decorators/require-business-membership.decorator.js';
import { RequireRole } from '../business-access/decorators/require-role.decorator.js';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { ImportTransactionsDto } from './dto/import-transactions.dto.js';
import { ImportsService } from './imports.service.js';

// Settings › Data & privacy › Import, into the open workspace. Those who
// may add entries (OWNER/ACCOUNTANT, as Income & Expense) may import them.
@RequireBusinessMembership()
@RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
@Controller('api/businesses/:businessId/imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Get()
  context(@Param('businessId') businessId: string) {
    return this.imports.context(businessId);
  }

  @Post('transactions')
  importRows(@Param('businessId') businessId: string, @Body() dto: ImportTransactionsDto, @CurrentUser() user: RequestUser) {
    return this.imports.importRows(businessId, dto, user.id);
  }
}
