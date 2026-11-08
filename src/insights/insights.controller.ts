import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { MemberRole } from '@prisma/client';
import { RequireBusinessMembership } from '../business-access/decorators/require-business-membership.decorator.js';
import { RequireRole } from '../business-access/decorators/require-role.decorator.js';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import { UserAuthGuard } from '../user-auth/guards/user-auth.guard.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { UpdateAiSettingsDto } from './dto/ai-settings.dto.js';
import { InsightsService } from './insights.service.js';

// AI Insights for a workspace's money: its owner and accountant read it.
@RequireBusinessMembership()
@RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
@Controller('api/businesses/:businessId/insights')
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  @Get()
  overview(@Param('businessId') businessId: string, @CurrentUser() user: RequestUser) {
    return this.insights.overview(businessId, user.id);
  }
}

// The person's own AI settings (the AI Insights page and Settings › Data &
// privacy): on or off, and what it may read.
@UseGuards(UserAuthGuard)
@Controller('api/insights/settings')
export class InsightsSettingsController {
  constructor(private readonly insights: InsightsService) {}

  @Get()
  settings(@CurrentUser() user: RequestUser) {
    return this.insights.settings(user.id);
  }

  @Put()
  update(@CurrentUser() user: RequestUser, @Body() dto: UpdateAiSettingsDto) {
    return this.insights.updateSettings(user.id, dto);
  }
}
