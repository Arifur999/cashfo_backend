import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateFeatureFlagDto } from './dto/create-feature-flag.dto.js';
import { UpdateFeatureFlagDto } from './dto/update-feature-flag.dto.js';

@Injectable()
export class FeatureFlagsService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.featureFlag.findMany({ orderBy: { key: 'asc' } });
  }

  async create(dto: CreateFeatureFlagDto, adminId: string) {
    const existing = await this.prisma.featureFlag.findUnique({ where: { key: dto.key } });
    if (existing) {
      throw new ConflictException('A feature flag with this key already exists');
    }

    return this.prisma.featureFlag.create({
      data: {
        key: dto.key,
        name: dto.name,
        description: dto.description,
        isEnabled: dto.isEnabled ?? false,
        rolloutPercent: dto.rolloutPercent ?? 0,
        targetPlanIds: dto.targetPlanIds ?? [],
        updatedBy: adminId,
      },
    });
  }

  async update(id: string, dto: UpdateFeatureFlagDto, adminId: string, ipAddress?: string) {
    const existing = await this.requireFlag(id);

    const result = await this.prisma.featureFlag.update({
      where: { id },
      data: {
        ...(dto.isEnabled !== undefined && { isEnabled: dto.isEnabled }),
        ...(dto.rolloutPercent !== undefined && { rolloutPercent: dto.rolloutPercent }),
        ...(dto.targetPlanIds !== undefined && { targetPlanIds: dto.targetPlanIds }),
        updatedBy: adminId,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        adminUserId: adminId,
        action: 'FEATURE_FLAG_UPDATED',
        entityType: 'FeatureFlag',
        entityId: id,
        oldValue: { isEnabled: existing.isEnabled, rolloutPercent: existing.rolloutPercent, targetPlanIds: existing.targetPlanIds },
        newValue: { isEnabled: result.isEnabled, rolloutPercent: result.rolloutPercent, targetPlanIds: result.targetPlanIds },
        ipAddress,
      },
    });

    return result;
  }

  // Public, unauthenticated by design -- see the controller for why this one
  // route skips AdminAuthGuard: it's meant to be called by end-user devices,
  // which have no admin session at all (same reasoning as the analytics
  // /track endpoint from Prompt 7).
  async evaluate(key: string, platformUserId: string) {
    const flag = await this.prisma.featureFlag.findUnique({ where: { key } });
    if (!flag || !flag.isEnabled) {
      return { enabled: false };
    }

    if (flag.targetPlanIds.length > 0) {
      const user = await this.prisma.platformUser.findUnique({ where: { id: platformUserId }, select: { planId: true } });
      if (!user?.planId || !flag.targetPlanIds.includes(user.planId)) {
        return { enabled: false };
      }
    }

    if (flag.rolloutPercent >= 100) return { enabled: true };
    if (flag.rolloutPercent <= 0) return { enabled: false };

    // Deterministic bucket from a hash of (key, user) -- the same user
    // always gets the same answer for the same flag on every call, rather
    // than a fresh coin flip each time, while still landing ~uniformly
    // across many different users.
    const hash = createHash('sha256').update(`${key}:${platformUserId}`).digest();
    const bucket = hash.readUInt32BE(0) % 100;
    return { enabled: bucket < flag.rolloutPercent };
  }

  private async requireFlag(id: string) {
    const flag = await this.prisma.featureFlag.findUnique({ where: { id } });
    if (!flag) {
      throw new NotFoundException('Feature flag not found');
    }
    return flag;
  }
}
