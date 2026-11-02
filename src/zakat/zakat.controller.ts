import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import { MemberRole } from '@prisma/client';
import type { Request } from 'express';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator.js';
import { Roles } from '../admin-auth/decorators/roles.decorator.js';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard.js';
import { RolesGuard } from '../admin-auth/guards/roles.guard.js';
import type { RequestAdminUser } from '../admin-auth/interfaces/request-admin-user.interface.js';
import { RequireBusinessMembership } from '../business-access/decorators/require-business-membership.decorator.js';
import { RequireRole } from '../business-access/decorators/require-role.decorator.js';
import { AdminRole } from '../common/roles.js';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import {
  CreateZakatExtraDto,
  RecordZakatDto,
  UpdateZakatPricesDto,
  UpdateZakatSettingsDto,
  ZakatAssetWeightDto,
  ZakatCheckDto,
  ZakatDebtModeDto,
  ZakatForSaleDto,
  ZakatLineDto,
} from './dto/zakat.dto.js';
import { ZakatPricesService } from './zakat-prices.service.js';
import { ZakatService } from './zakat.service.js';

// Zakat calculator for a workspace: its owner and accountant, who keep its
// money, read it and change it. Every write answers the summary again.
@RequireBusinessMembership()
@RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
@Controller('api/businesses/:businessId/zakat')
export class ZakatController {
  constructor(private readonly zakat: ZakatService) {}

  @Get()
  summary(@Param('businessId') businessId: string) {
    return this.zakat.summary(businessId);
  }

  @Patch('settings')
  updateSettings(@Param('businessId') businessId: string, @Body() dto: UpdateZakatSettingsDto) {
    return this.zakat.updateSettings(businessId, dto);
  }

  @Put('lines')
  setLine(@Param('businessId') businessId: string, @Body() dto: ZakatLineDto) {
    return this.zakat.setLine(businessId, dto);
  }

  @Put('debts/:contactId')
  setDebtMode(@Param('businessId') businessId: string, @Param('contactId') contactId: string, @Body() dto: ZakatDebtModeDto) {
    return this.zakat.setDebtMode(businessId, contactId, dto.mode);
  }

  @Put('assets/:assetId/for-sale')
  setForSale(@Param('businessId') businessId: string, @Param('assetId') assetId: string, @Body() dto: ZakatForSaleDto) {
    return this.zakat.setForSale(businessId, assetId, dto.forSale);
  }

  @Put('assets/:assetId/weight')
  setAssetWeight(@Param('businessId') businessId: string, @Param('assetId') assetId: string, @Body() dto: ZakatAssetWeightDto) {
    return this.zakat.setAssetWeight(businessId, assetId, dto);
  }

  @Put('checked')
  setChecked(@Param('businessId') businessId: string, @Body() dto: ZakatCheckDto) {
    return this.zakat.setChecked(businessId, dto);
  }

  @Post('extras')
  addExtra(@Param('businessId') businessId: string, @Body() dto: CreateZakatExtraDto) {
    return this.zakat.addExtra(businessId, dto);
  }

  @Delete('extras/:id')
  removeExtra(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.zakat.removeExtra(businessId, id);
  }

  @Post('payments')
  recordPayment(@Param('businessId') businessId: string, @Body() dto: RecordZakatDto, @CurrentUser() user: RequestUser) {
    return this.zakat.recordPayment(businessId, dto, user.id);
  }

  @Delete('payments/:id')
  @HttpCode(200)
  deletePayment(@Param('businessId') businessId: string, @Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.zakat.deletePayment(businessId, id, user.id);
  }
}

// Admin > Settings > Zakat prices: the BAJUS gold and silver prices every
// member's zakat starts from. Any admin reads; super and finance admins change.
@UseGuards(AdminAuthGuard, RolesGuard)
@Controller('admin/zakat/prices')
export class AdminZakatPricesController {
  constructor(private readonly prices: ZakatPricesService) {}

  @Get()
  get() {
    return this.prices.get();
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.FINANCE_ADMIN)
  @Patch()
  update(@Body() dto: UpdateZakatPricesDto, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.prices.update(dto, admin.id, req.ip);
  }
}
