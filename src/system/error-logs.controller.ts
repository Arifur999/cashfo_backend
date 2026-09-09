import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AdminRole } from '@prisma/client';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator.js';
import { Roles } from '../admin-auth/decorators/roles.decorator.js';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard.js';
import { RolesGuard } from '../admin-auth/guards/roles.guard.js';
import type { RequestAdminUser } from '../admin-auth/interfaces/request-admin-user.interface.js';
import { ErrorLogsService } from './error-logs.service.js';
import { ListErrorLogsQueryDto } from './dto/list-error-logs-query.dto.js';
import { ReportErrorDto } from './dto/report-error.dto.js';

// No class-level guard: `report` deliberately allows any authenticated admin
// (not just SUPER_ADMIN) so a crash in a Support/Finance/Content admin's own
// session still gets logged -- restricting it to SUPER_ADMIN would silently
// drop every other role's error reports, defeating the point of this module.
@Controller('admin/system/errors')
export class ErrorLogsController {
  constructor(private readonly errorLogsService: ErrorLogsService) {}

  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles(AdminRole.SUPER_ADMIN)
  @Get()
  list(@Query() query: ListErrorLogsQueryDto) {
    return this.errorLogsService.list(query);
  }

  @UseGuards(AdminAuthGuard)
  @Post()
  report(@Body() dto: ReportErrorDto) {
    return this.errorLogsService.report(dto);
  }

  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles(AdminRole.SUPER_ADMIN)
  @Patch(':id/resolve')
  resolve(@Param('id') id: string, @CurrentAdmin() admin: RequestAdminUser) {
    return this.errorLogsService.resolve(id, admin.id);
  }
}
