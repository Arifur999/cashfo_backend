import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AdminRole } from '../common/roles.js';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator.js';
import { Roles } from '../admin-auth/decorators/roles.decorator.js';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard.js';
import { RolesGuard } from '../admin-auth/guards/roles.guard.js';
import type { RequestAdminUser } from '../admin-auth/interfaces/request-admin-user.interface.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import { UserAuthGuard } from '../user-auth/guards/user-auth.guard.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { CreateFeatureFlagDto } from './dto/create-feature-flag.dto.js';
import { EvaluateFeatureFlagQueryDto } from './dto/evaluate-feature-flag-query.dto.js';
import { UpdateFeatureFlagDto } from './dto/update-feature-flag.dto.js';
import { FeatureFlagsService } from './feature-flags.service.js';

// No class-level guard here on purpose: `evaluate` is for a signed-in
// customer (UserAuthGuard) while every other route is SUPER_ADMIN only, so
// each route declares its own guards. The customer app reads every flag at
// once through GET /api/platform instead.
@Controller('admin/system/feature-flags')
export class FeatureFlagsController {
  constructor(
    private readonly featureFlagsService: FeatureFlagsService,
    private readonly prisma: PrismaService,
  ) {}

  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles(AdminRole.SUPER_ADMIN)
  @Get()
  list() {
    return this.featureFlagsService.list();
  }

  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles(AdminRole.SUPER_ADMIN)
  @Post()
  create(@Body() dto: CreateFeatureFlagDto, @CurrentAdmin() admin: RequestAdminUser) {
    return this.featureFlagsService.create(dto, admin.id);
  }

  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles(AdminRole.SUPER_ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateFeatureFlagDto, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.featureFlagsService.update(id, dto, admin.id, req.ip);
  }

  @UseGuards(UserAuthGuard)
  @Get('evaluate')
  async evaluate(@Query() query: EvaluateFeatureFlagQueryDto, @CurrentUser() user: RequestUser) {
    const owned = await this.prisma.business.findMany({ where: { ownerId: user.id, deletedAt: null, planId: { not: null } }, select: { planId: true } });
    return this.featureFlagsService.evaluate(
      query.key,
      user.id,
      owned.map((b) => b.planId!),
    );
  }
}
