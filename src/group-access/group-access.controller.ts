import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { MemberRole } from '@prisma/client';
import { RequireBusinessMembership } from '../business-access/decorators/require-business-membership.decorator.js';
import { RequireRole } from '../business-access/decorators/require-role.decorator.js';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { CreateAccessLinkDto } from './dto/group-access.dto.js';
import { GroupAccessService } from './group-access.service.js';

// The owner's side of a member's access link (Members page). The owner
// alone: a group's Viewers and Editors never reach it.
@RequireBusinessMembership()
@RequireRole(MemberRole.OWNER)
@Controller('api/businesses/:businessId/group/members/:memberId/access-link')
export class GroupAccessController {
  constructor(private readonly access: GroupAccessService) {}

  // A new link (any older one stops working). The token comes back once;
  // the frontend builds the link from it.
  @Post()
  create(@Param('businessId') businessId: string, @Param('memberId') memberId: string, @Body() dto: CreateAccessLinkDto, @CurrentUser() user: RequestUser) {
    return this.access.createLink(businessId, memberId, dto.kind, user.id);
  }

  // The waiting link again, to copy.
  @Get()
  read(@Param('businessId') businessId: string, @Param('memberId') memberId: string) {
    return this.access.readLink(businessId, memberId);
  }

  @Delete()
  cancel(@Param('businessId') businessId: string, @Param('memberId') memberId: string, @CurrentUser() user: RequestUser) {
    return this.access.cancelLink(businessId, memberId, user.id);
  }
}
