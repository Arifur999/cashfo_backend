import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AdminRole } from '@prisma/client';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator.js';
import { Roles } from '../admin-auth/decorators/roles.decorator.js';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard.js';
import { RolesGuard } from '../admin-auth/guards/roles.guard.js';
import type { RequestAdminUser } from '../admin-auth/interfaces/request-admin-user.interface.js';
import { CouponsService } from './coupons.service.js';
import { CreateCouponDto } from './dto/create-coupon.dto.js';
import { UpdateCouponDto } from './dto/update-coupon.dto.js';

@UseGuards(AdminAuthGuard, RolesGuard)
@Controller('admin/coupons')
export class CouponsController {
  constructor(private readonly couponsService: CouponsService) {}

  @Get()
  list() {
    return this.couponsService.list();
  }

  @Get(':id/redemptions')
  getRedemptions(@Param('id') id: string) {
    return this.couponsService.getRedemptions(id);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.FINANCE_ADMIN)
  @Post()
  create(@Body() dto: CreateCouponDto, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.couponsService.create(dto, admin.id, req.ip);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.FINANCE_ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCouponDto, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.couponsService.update(id, dto, admin.id, req.ip);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.FINANCE_ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.couponsService.remove(id, admin.id, req.ip);
  }
}
