import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { MemberRole } from '@prisma/client';
import { RequireBusinessMembership } from '../business-access/decorators/require-business-membership.decorator.js';
import { RequireRole } from '../business-access/decorators/require-role.decorator.js';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { AssetsService } from './assets.service.js';
import { CreateAssetCategoryDto } from './dto/create-asset-category.dto.js';
import { CreateAssetPurchaseDto } from './dto/create-asset-purchase.dto.js';
import { SellAssetDto } from './dto/sell-asset.dto.js';
import { UpdateAssetCategoryDto } from './dto/update-asset-category.dto.js';
import { UpdateAssetValueDto } from './dto/update-asset-value.dto.js';
import { UpdateAssetDto } from './dto/update-asset.dto.js';

@RequireBusinessMembership()
@Controller('api/businesses/:businessId/assets')
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Get()
  list(@Param('businessId') businessId: string) {
    return this.assetsService.list(businessId);
  }

  @Get('categories')
  listCategories(@Param('businessId') businessId: string) {
    return this.assetsService.listCategories(businessId);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Post('categories')
  createCategory(@Param('businessId') businessId: string, @Body() dto: CreateAssetCategoryDto) {
    return this.assetsService.createCategory(businessId, dto);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Patch('categories/:id')
  updateCategory(@Param('businessId') businessId: string, @Param('id') id: string, @Body() dto: UpdateAssetCategoryDto) {
    return this.assetsService.updateCategory(businessId, id, dto);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Delete('categories/:id')
  deleteCategory(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.assetsService.deleteCategory(businessId, id);
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

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Patch(':id/value/:entryId')
  editValueUpdate(@Param('businessId') businessId: string, @Param('id') id: string, @Param('entryId') entryId: string, @Body() dto: UpdateAssetValueDto) {
    return this.assetsService.editValueUpdate(businessId, id, entryId, dto);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Delete(':id/value/:entryId')
  deleteValueUpdate(@Param('businessId') businessId: string, @Param('id') id: string, @Param('entryId') entryId: string) {
    return this.assetsService.deleteValueUpdate(businessId, id, entryId);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Patch(':id')
  update(@Param('businessId') businessId: string, @Param('id') id: string, @Body() dto: UpdateAssetDto, @CurrentUser() user: RequestUser) {
    return this.assetsService.update(businessId, id, dto, user.id);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Delete(':id')
  remove(@Param('businessId') businessId: string, @Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.assetsService.remove(businessId, id, user.id);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Patch(':id/sale')
  editSale(@Param('businessId') businessId: string, @Param('id') id: string, @Body() dto: SellAssetDto, @CurrentUser() user: RequestUser) {
    return this.assetsService.editSale(businessId, id, dto, user.id);
  }

  // Undo of a delete, for a few minutes after it.
  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Post(':id/restore')
  restore(@Param('businessId') businessId: string, @Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.assetsService.restore(businessId, id, user.id);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Post(':id/undo-sale')
  undoSale(@Param('businessId') businessId: string, @Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.assetsService.undoSale(businessId, id, user.id);
  }
}
