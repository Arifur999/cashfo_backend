import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateCouponDto } from './dto/create-coupon.dto.js';
import { UpdateCouponDto } from './dto/update-coupon.dto.js';

function computeStatus(coupon: { isActive: boolean; validFrom: Date; validUntil: Date }): 'ACTIVE' | 'EXPIRED' | 'DISABLED' | 'SCHEDULED' {
  if (!coupon.isActive) return 'DISABLED';
  const now = new Date();
  if (now < coupon.validFrom) return 'SCHEDULED';
  if (now > coupon.validUntil) return 'EXPIRED';
  return 'ACTIVE';
}

@Injectable()
export class CouponsService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const coupons = await this.prisma.coupon.findMany({ orderBy: { createdAt: 'desc' } });
    return coupons.map((coupon) => ({ ...coupon, status: computeStatus(coupon) }));
  }

  async create(dto: CreateCouponDto) {
    if (new Date(dto.validUntil) <= new Date(dto.validFrom)) {
      throw new BadRequestException('validUntil must be after validFrom');
    }

    const existing = await this.prisma.coupon.findUnique({ where: { code: dto.code } });
    if (existing) {
      throw new ConflictException('A coupon with this code already exists');
    }

    return this.prisma.coupon.create({
      data: {
        code: dto.code,
        discountType: dto.discountType,
        discountValue: dto.discountValue,
        maxRedemptions: dto.maxRedemptions,
        validFrom: new Date(dto.validFrom),
        validUntil: new Date(dto.validUntil),
        applicablePlans: dto.applicablePlans ?? [],
      },
    });
  }

  async update(id: string, dto: UpdateCouponDto) {
    const coupon = await this.requireCoupon(id);

    const validFrom = dto.validFrom !== undefined ? new Date(dto.validFrom) : coupon.validFrom;
    const validUntil = dto.validUntil !== undefined ? new Date(dto.validUntil) : coupon.validUntil;
    if (validUntil <= validFrom) {
      throw new BadRequestException('validUntil must be after validFrom');
    }

    return this.prisma.coupon.update({
      where: { id },
      data: {
        ...(dto.code !== undefined && { code: dto.code }),
        ...(dto.discountType !== undefined && { discountType: dto.discountType }),
        ...(dto.discountValue !== undefined && { discountValue: dto.discountValue }),
        ...(dto.maxRedemptions !== undefined && { maxRedemptions: dto.maxRedemptions }),
        ...(dto.validFrom !== undefined && { validFrom }),
        ...(dto.validUntil !== undefined && { validUntil }),
        ...(dto.applicablePlans !== undefined && { applicablePlans: dto.applicablePlans }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  async getRedemptions(id: string) {
    await this.requireCoupon(id);

    const redemptions = await this.prisma.couponRedemption.findMany({
      where: { couponId: id },
      orderBy: { redeemedAt: 'desc' },
      include: { plan: { select: { id: true, name: true } } },
    });

    // CouponRedemption.platformUserId is a loose reference (no Prisma
    // relation defined), so the matching PlatformUser names are fetched
    // separately and merged in here.
    const userIds = [...new Set(redemptions.map((r) => r.platformUserId))];
    const users = await this.prisma.platformUser.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true },
    });
    const userById = new Map(users.map((u) => [u.id, u]));

    return redemptions.map((r) => ({
      ...r,
      platformUser: userById.get(r.platformUserId) ?? null,
    }));
  }

  private async requireCoupon(id: string) {
    const coupon = await this.prisma.coupon.findUnique({ where: { id } });
    if (!coupon) {
      throw new NotFoundException('Coupon not found');
    }
    return coupon;
  }
}
