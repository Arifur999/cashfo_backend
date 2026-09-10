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
} as const;

export interface PlatformSettings {
  platformName: string;
  supportEmail: string;
  defaultCurrency: string;
  defaultTimezone: string;
  maintenanceMode: boolean;
  maintenanceMessage: string;
}

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

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
    };
  }

  async update(dto: UpdateSettingsDto, adminId: string, ipAddress?: string): Promise<PlatformSettings> {
    const before = await this.get();

    const updates: [string, string | boolean][] = [];
    if (dto.platformName !== undefined) updates.push(['platform_name', dto.platformName]);
    if (dto.supportEmail !== undefined) updates.push(['support_email', dto.supportEmail]);
    if (dto.defaultCurrency !== undefined) updates.push(['default_currency', dto.defaultCurrency]);
    if (dto.defaultTimezone !== undefined) updates.push(['default_timezone', dto.defaultTimezone]);
    if (dto.maintenanceMode !== undefined) updates.push(['maintenance_mode', dto.maintenanceMode]);
    if (dto.maintenanceMessage !== undefined) updates.push(['maintenance_message', dto.maintenanceMessage]);

    for (const [key, value] of updates) {
      await this.prisma.platformSetting.upsert({
        where: { key },
        update: { value: value as unknown as Prisma.InputJsonValue, updatedBy: adminId },
        create: { key, value: value as unknown as Prisma.InputJsonValue, updatedBy: adminId },
      });
    }

    const after = await this.get();

    if (updates.length > 0) {
      await this.prisma.auditLog.create({
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

    return after;
  }
}
