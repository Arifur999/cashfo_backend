import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { UpdateSettingsDto } from './dto/update-settings.dto.js';

// Fixed, curated set of general platform settings backed by the generic
// PlatformSetting key-value table from Prompt 1 (never used until now). Kept
// as named, typed fields on the API rather than exposing raw key/value pairs
// to the admin -- same "don't make the admin hand-edit JSON" reasoning as the
// notification-campaign target filter.
const DEFAULTS = {
  platform_name: 'Money Management Tracker',
  support_email: 'support@example.com',
  default_currency: 'BDT',
  default_timezone: 'Asia/Dhaka',
  maintenance_mode: false,
  maintenance_message: "We're currently performing scheduled maintenance. Please check back soon.",
  // "Referral Program" menu's admin-configured reward per confirmed
  // referral -- 100 BDT is the product owner's explicit demo default.
  referral_reward_amount: 100,
} as const;

const KEY_TO_FIELD: Record<string, keyof PlatformSettings> = {
  platform_name: 'platformName',
  support_email: 'supportEmail',
  default_currency: 'defaultCurrency',
  default_timezone: 'defaultTimezone',
  maintenance_mode: 'maintenanceMode',
  maintenance_message: 'maintenanceMessage',
  referral_reward_amount: 'referralRewardAmount',
};

export interface PlatformSettings {
  platformName: string;
  supportEmail: string;
  defaultCurrency: string;
  defaultTimezone: string;
  maintenanceMode: boolean;
  maintenanceMessage: string;
  referralRewardAmount: number;
}

// How long getCached() may serve a copy. The maintenance switch reads
// settings on every customer request; a few seconds of delay after an admin
// flips it is fine, a database round trip per request is not.
const CACHE_TTL_MS = 5_000;

@Injectable()
export class SettingsService {
  private cached: { value: PlatformSettings; at: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  // For per-request readers. update() clears it, so this process sees its
  // own changes at once.
  async getCached(): Promise<PlatformSettings> {
    if (this.cached && Date.now() - this.cached.at < CACHE_TTL_MS) {
      return this.cached.value;
    }
    const value = await this.get();
    this.cached = { value, at: Date.now() };
    return value;
  }

  async get(): Promise<PlatformSettings> {
    const rows = await this.prisma.platformSetting.findMany();
    const byKey = new Map(rows.map((r) => [r.key, r.value]));

    return {
      platformName: (byKey.get('platform_name') as string | undefined) ?? DEFAULTS.platform_name,
      supportEmail: (byKey.get('support_email') as string | undefined) ?? DEFAULTS.support_email,
      defaultCurrency: (byKey.get('default_currency') as string | undefined) ?? DEFAULTS.default_currency,
      defaultTimezone: (byKey.get('default_timezone') as string | undefined) ?? DEFAULTS.default_timezone,
      maintenanceMode: (byKey.get('maintenance_mode') as boolean | undefined) ?? DEFAULTS.maintenance_mode,
      maintenanceMessage: (byKey.get('maintenance_message') as string | undefined) ?? DEFAULTS.maintenance_message,
      referralRewardAmount: (byKey.get('referral_reward_amount') as number | undefined) ?? DEFAULTS.referral_reward_amount,
    };
  }

  async update(dto: UpdateSettingsDto, adminId: string, ipAddress?: string): Promise<PlatformSettings> {
    const before = await this.get();

    const updates: [string, string | boolean | number][] = [];
    if (dto.platformName !== undefined) updates.push(['platform_name', dto.platformName]);
    if (dto.supportEmail !== undefined) updates.push(['support_email', dto.supportEmail]);
    if (dto.defaultCurrency !== undefined) updates.push(['default_currency', dto.defaultCurrency]);
    if (dto.defaultTimezone !== undefined) updates.push(['default_timezone', dto.defaultTimezone]);
    if (dto.maintenanceMode !== undefined) updates.push(['maintenance_mode', dto.maintenanceMode]);
    if (dto.maintenanceMessage !== undefined) updates.push(['maintenance_message', dto.maintenanceMessage]);
    if (dto.referralRewardAmount !== undefined) updates.push(['referral_reward_amount', dto.referralRewardAmount]);

    // Every field and its audit entry together: a failure half-way used to
    // leave some settings changed with no record of who changed them.
    await this.prisma.$transaction(async (tx) => {
      for (const [key, value] of updates) {
        await tx.platformSetting.upsert({
          where: { key },
          update: { value: value as unknown as Prisma.InputJsonValue, updatedBy: adminId },
          create: { key, value: value as unknown as Prisma.InputJsonValue, updatedBy: adminId },
        });
      }
      if (updates.length > 0) {
        const after = { ...before, ...Object.fromEntries(updates.map(([key, value]) => [KEY_TO_FIELD[key], value])) };
        await tx.auditLog.create({
          data: {
            adminUserId: adminId,
            action: 'PLATFORM_SETTINGS_UPDATED',
            entityType: 'PlatformSetting',
            oldValue: before as unknown as Prisma.InputJsonValue,
            newValue: after as unknown as Prisma.InputJsonValue,
            ipAddress,
          },
        });
      }
    });

    this.cached = null;
    return this.get();
  }
}
