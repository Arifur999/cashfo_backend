import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { FeatureFlag } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateFeatureFlagDto } from './dto/create-feature-flag.dto.js';
import { UpdateFeatureFlagDto } from './dto/update-feature-flag.dto.js';

// Flags the customer app reads (see the frontend's lib/customer/platform.ts
// and the places that check them). Any other key can be created and toggled
// but changes nothing until code checks it -- the admin list says so.
export const WIRED_FEATURE_FLAGS: Record<string, string> = {
  loan_management: 'Shows the Loan Management section',
  dark_mode: 'Shows the light/dark theme switch',
  pdf_export: 'Shows Print / Save as PDF on reports',
};

@Injectable()
export class FeatureFlagsService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const flags = await this.prisma.featureFlag.findMany({ orderBy: { key: 'asc' } });
    return flags.map((flag) => ({ ...flag, usedFor: WIRED_FEATURE_FLAGS[flag.key] ?? null }));
  }

  // Every flag, evaluated for one customer: { key: enabled }. planIds are
  // the plans of the workspaces they own -- a plan-targeted flag is on when
  // any of them matches.
  async evaluateAllFor(userId: string, planIds: string[]): Promise<Record<string, boolean>> {
    const flags = await this.prisma.featureFlag.findMany();
    return Object.fromEntries(flags.map((flag) => [flag.key, this.isOnFor(flag, userId, planIds)]));
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

  // One flag for the signed-in customer. It used to be public and keyed by
  // a caller-supplied legacy PlatformUser id, so anyone could probe any flag
  // for any id and plan targeting read a table nothing writes.
  async evaluate(key: string, userId: string, planIds: string[]) {
    const flag = await this.prisma.featureFlag.findUnique({ where: { key } });
    return { enabled: !!flag && this.isOnFor(flag, userId, planIds) };
  }

  private isOnFor(flag: FeatureFlag, userId: string, planIds: string[]): boolean {
    if (!flag.isEnabled) return false;
    if (flag.targetPlanIds.length > 0 && !planIds.some((id) => flag.targetPlanIds.includes(id))) return false;
    if (flag.rolloutPercent >= 100) return true;
    if (flag.rolloutPercent <= 0) return false;

    // Deterministic bucket from a hash of (key, user) -- the same user
    // always gets the same answer for the same flag on every call, rather
    // than a fresh coin flip each time, while still landing ~uniformly
    // across many different users.
    const hash = createHash('sha256').update(`${flag.key}:${userId}`).digest();
    return hash.readUInt32BE(0) % 100 < flag.rolloutPercent;
  }

  private async requireFlag(id: string) {
    const flag = await this.prisma.featureFlag.findUnique({ where: { id } });
    if (!flag) {
      throw new NotFoundException('Feature flag not found');
    }
    return flag;
  }
}
