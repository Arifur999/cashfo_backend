import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AdminRole } from '@prisma/client';
import { Roles } from '../admin-auth/decorators/roles.decorator.js';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard.js';
import { RolesGuard } from '../admin-auth/guards/roles.guard.js';
import { AuditLogsService } from './audit-logs.service.js';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto.js';

// SUPER_ADMIN only, across the whole controller: the audit trail records
// every admin's actions, and letting one admin browse another's activity
// (e.g. SUPPORT_ADMIN reviewing SUPPORT_ADMIN) would let one cover for
// another -- see the module-level note in security.module.ts.
@UseGuards(AdminAuthGuard, RolesGuard)
@Roles(AdminRole.SUPER_ADMIN)
@Controller('admin/audit-logs')
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Get()
  list(@Query() query: ListAuditLogsQueryDto) {
    return this.auditLogsService.list(query);
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.auditLogsService.getById(id);
  }
}
