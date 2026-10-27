import { Controller, Get, Headers, Query, UseGuards } from '@nestjs/common';
import { WORKSPACE_UNLOCK_HEADER } from '../business-access/workspace-unlock.service.js';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import { UserAuthGuard } from '../user-auth/guards/user-auth.guard.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { GroupSummaryQueryDto } from './dto/group-summary-query.dto.js';
import { GroupSummaryService } from './group-summary.service.js';

// Across the customer's groups, so not under :businessId (and not behind
// the one-workspace membership guard): the service picks the groups the
// user is an active member of and keeps PIN-locked ones shut itself.
@UseGuards(UserAuthGuard)
@Controller('api/businesses/groups')
export class GroupSummaryController {
  constructor(private readonly summaryService: GroupSummaryService) {}

  @Get('summary')
  summary(@CurrentUser() user: RequestUser, @Query() query: GroupSummaryQueryDto, @Headers(WORKSPACE_UNLOCK_HEADER) unlock: string | undefined) {
    return this.summaryService.summary(user, query.month, unlock);
  }
}
