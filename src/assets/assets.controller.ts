import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { MemberRole } from '@prisma/client';
import { RequireBusinessMembership } from '../business-access/decorators/require-business-membership.decorator.js';
import { RequireRole } from '../business-access/decorators/require-role.decorator.js';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { AssetsService } from './assets.service.js';
import { CreateAssetPurchaseDto } from './dto/create-asset-purchase.dto.js';
import { SellAssetDto } from './dto/sell-asset.dto.js';
import { UpdateAssetValueDto } from './dto/update-asset-value.dto.js';

@RequireBusinessMembership()
@Controller('api/businesses/:businessId/assets')
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Get()
  list(@Param('businessId') businessId: string) {
    return this.assetsService.list(businessId);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Post()
  purchase(@Param('businessId') businessId: string, @Body() dto: CreateAssetPurchaseDto, @CurrentUser() user: RequestUser) {
    return this.assetsService.purchase(businessId, dto, user.id);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Post(':id/sell')
  sell(@Param('businessId') businessId: string, @Param('id') id: string, @Body() dto: SellAssetDto, @CurrentUser() user: RequestUser) {
    return this.assetsService.sell(businessId, id, dto, user.id);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Post(':id/value')
  updateValue(@Param('businessId') businessId: string, @Param('id') id: string, @Body() dto: UpdateAssetValueDto) {
    return this.assetsService.updateValue(businessId, id, dto);
  }
}
