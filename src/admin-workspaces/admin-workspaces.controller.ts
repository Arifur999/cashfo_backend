import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard.js';
import { RolesGuard } from '../admin-auth/guards/roles.guard.js';
import { AdminWorkspacesService } from './admin-workspaces.service.js';
import { ListWorkspaceOverviewQueryDto } from './dto/list-workspace-overview-query.dto.js';

// Read-only -- no @Roles() on the one route, same convention as
// PlatformUsersController's GET routes: any authenticated admin can view it,
// RolesGuard just needs AdminAuthGuard to have run first.
@UseGuards(AdminAuthGuard, RolesGuard)
@Controller('admin/workspaces')
export class AdminWorkspacesController {
  constructor(private readonly adminWorkspacesService: AdminWorkspacesService) {}

  @Get('overview')
  overview(@Query() query: ListWorkspaceOverviewQueryDto) {
    return this.adminWorkspacesService.overview(query);
  }
}
