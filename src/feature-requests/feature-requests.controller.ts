import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { AdminRole } from '@prisma/client';
import { Roles } from '../admin-auth/decorators/roles.decorator.js';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard.js';
import { RolesGuard } from '../admin-auth/guards/roles.guard.js';
import { ListFeatureRequestsQueryDto } from './dto/list-feature-requests-query.dto.js';
import { UpdateFeatureRequestDto } from './dto/update-feature-request.dto.js';
import { FeatureRequestsService } from './feature-requests.service.js';

@UseGuards(AdminAuthGuard, RolesGuard)
@Controller('admin/feature-requests')
export class FeatureRequestsController {
  constructor(private readonly featureRequestsService: FeatureRequestsService) {}

  @Get()
  list(@Query() query: ListFeatureRequestsQueryDto) {
    return this.featureRequestsService.list(query);
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.featureRequestsService.getById(id);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.SUPPORT_ADMIN)
  @Patch(':id')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateFeatureRequestDto) {
    return this.featureRequestsService.updateStatus(id, dto);
  }
}
