import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AdminRole } from '../common/roles.js';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator.js';
import { Roles } from '../admin-auth/decorators/roles.decorator.js';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard.js';
import { RolesGuard } from '../admin-auth/guards/roles.guard.js';
import type { RequestAdminUser } from '../admin-auth/interfaces/request-admin-user.interface.js';
import { ErrorLogsService } from './error-logs.service.js';
import { ErrorGroupsQueryDto, ResolveErrorsDto } from './dto/error-groups.dto.js';
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

  // Static routes, before the :id ones below.
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles(AdminRole.SUPER_ADMIN)
  @Get('groups')
  groups(@Query() query: ErrorGroupsQueryDto) {
    return this.errorLogsService.groups(query);
  }

  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles(AdminRole.SUPER_ADMIN)
  @Post('resolve-all')
  @HttpCode(200)
  resolveAll(@Body() dto: ResolveErrorsDto, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.errorLogsService.resolveAll(dto, admin.id, req.ip);
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
