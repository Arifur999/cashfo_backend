import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { BusinessesService } from './businesses.service.js';
import { CurrentBusinessMember } from './decorators/current-business-member.decorator.js';
import { RequireBusinessMembership } from './decorators/require-business-membership.decorator.js';
import { CreateBusinessDto } from './dto/create-business.dto.js';
import { UpdateBusinessDto } from './dto/update-business.dto.js';
import type { RequestBusinessMember } from './interfaces/request-business-member.interface.js';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import { UserAuthGuard } from '../user-auth/guards/user-auth.guard.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';

@Controller('api/businesses')
export class BusinessesController {
  constructor(private readonly businessesService: BusinessesService) {}

  // No :id in play yet -- just needs to know who's asking.
  @UseGuards(UserAuthGuard)
  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.businessesService.list(user.id);
  }

  @UseGuards(UserAuthGuard)
  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateBusinessDto) {
    return this.businessesService.create(user.id, dto);
  }

  // "Switching" workspaces is deliberately NOT a backend endpoint -- see
  // BusinessesModule's top comment for why. There is no PATCH /:id/switch.

  @RequireBusinessMembership()
  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.businessesService.getOne(id);
  }

  @RequireBusinessMembership()
  @Patch(':id')
  update(@Param('id') id: string, @CurrentBusinessMember() member: RequestBusinessMember, @Body() dto: UpdateBusinessDto) {
    return this.businessesService.update(id, member, dto);
  }

  @RequireBusinessMembership()
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentBusinessMember() member: RequestBusinessMember) {
    return this.businessesService.remove(id, member);
  }
}
