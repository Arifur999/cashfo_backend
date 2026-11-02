import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { UpdateZakatPricesDto } from './dto/zakat.dto.js';
import { BAJUS_DEFAULT } from './zakat-rules.js';

// The platform's gold and silver prices per vori (22 karat), as an admin
// enters them from BAJUS (there is no official feed), and the day they
// are from. A member can still use their own in Zakat settings.
const KEYS = { gold22: 'zakat_gold22_per_vori', silver22: 'zakat_silver22_per_vori', on: 'zakat_prices_on' } as const;

export interface ZakatPrices {
  gold22: number;
  silver22: number;
  // "2026-10-31"
  on: string;
  updatedAt: Date | null;
  updatedBy: string | null;
}

const whole = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback);
const day = (value: unknown, fallback: string) => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback);

@Injectable()
export class ZakatPricesService {
  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<ZakatPrices> {
    const rows = await this.prisma.platformSetting.findMany({ where: { key: { in: Object.values(KEYS) } } });
    const byKey = new Map(rows.map((row) => [row.key, row]));
    const gold = byKey.get(KEYS.gold22);
    return {
      gold22: whole(gold?.value, BAJUS_DEFAULT.gold22),
      silver22: whole(byKey.get(KEYS.silver22)?.value, BAJUS_DEFAULT.silver22),
      on: day(byKey.get(KEYS.on)?.value, BAJUS_DEFAULT.on),
      updatedAt: gold?.updatedAt ?? null,
      updatedBy: gold?.updatedBy ?? null,
    };
  }

  // Admin > Settings: new BAJUS prices. Audited, in one transaction.
  async update(dto: UpdateZakatPricesDto, adminId: string, ipAddress?: string): Promise<ZakatPrices> {
    const before = await this.get();
    await this.prisma.$transaction(async (tx) => {
      for (const [key, value] of [
        [KEYS.gold22, dto.gold22],
        [KEYS.silver22, dto.silver22],
        [KEYS.on, dto.on],
      ] as const) {
        await tx.platformSetting.upsert({ where: { key }, update: { value, updatedBy: adminId }, create: { key, value, updatedBy: adminId } });
      }
      await tx.auditLog.create({
        data: {
          adminUserId: adminId,
          action: 'ZAKAT_PRICES_UPDATED',
          entityType: 'PlatformSetting',
          entityId: KEYS.gold22,
          oldValue: { gold22: before.gold22, silver22: before.silver22, on: before.on },
          newValue: { gold22: dto.gold22, silver22: dto.silver22, on: dto.on },
          ipAddress,
        },
      });
    });
    return this.get();
  }
}
