import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminRole } from '@prisma/client';
import { Roles } from '../admin-auth/decorators/roles.decorator.js';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard.js';
import { RolesGuard } from '../admin-auth/guards/roles.guard.js';
import { ListRateLimitsQueryDto } from './dto/list-rate-limits-query.dto.js';
import { RateLimitsService } from './rate-limits.service.js';

// SUPER_ADMIN only, entire controller -- see the note on BackupsController.
@UseGuards(AdminAuthGuard, RolesGuard)
@Roles(AdminRole.SUPER_ADMIN)
@Controller('admin/system/rate-limits')
export class RateLimitsController {
  constructor(private readonly rateLimitsService: RateLimitsService) {}

  @Get('summary')
  summary() {
    return this.rateLimitsService.summary();
  }

  @Get()
  list(@Query() query: ListRateLimitsQueryDto) {
    return this.rateLimitsService.list(query);
  }
}
