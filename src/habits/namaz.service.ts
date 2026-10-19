import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AsrSchool } from '@prisma/client';
import { dhakaDateOnly } from '../common/dhaka.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { LogQazaDto, SetQazaSinceDto, UpdatePrayerSettingsDto } from './dto/qaza.dto.js';
import { dayKey, missedSince, type PrayerCounts, zeroCounts } from './qaza.js';

// How many logged qaza come back with the summary.
const RECENT_LOGS = 20;

export interface QazaLogView {
  id: string;
  prayer: string;
  count: number;
  date: string;
}

export interface QazaView {
  // "YYYY-MM-DD" counting starts from: the person's own day, else the first
  // day of their earliest Namaz sheet.
  since: string;
  missed: PrayerCounts;
  madeUp: PrayerCounts;
  // Still to make up, by prayer and in all.
  left: PrayerCounts;
  totalLeft: number;
  recent: QazaLogView[];
}

export interface PrayerSettingsView {
  city: string;
  latitude: number;
  longitude: number;
  method: string;
  asrSchool: AsrSchool;
  hijriAdjust: number;
}

// Before anyone saves their own: Dhaka, the Karachi method most mosques in
// Bangladesh follow, Hanafi Asr, the Hijri date as calculated.
const DEFAULT_SETTINGS: PrayerSettingsView = { city: 'Dhaka', latitude: 23.8103, longitude: 90.4125, method: 'Karachi', asrSchool: 'HANAFI', hijriAdjust: 0 };

const settingsView = (row: PrayerSettingsView | null): PrayerSettingsView =>
  row ? { city: row.city, latitude: row.latitude, longitude: row.longitude, method: row.method, asrSchool: row.asrSchool, hijriAdjust: row.hijriAdjust } : DEFAULT_SETTINGS;

// The qaza a person owes: prayers missed on their Namaz sheets since the
// counting day, less the ones they logged with "I prayed a qaza". Also the
// settings prayer times are worked out from.
@Injectable()
export class NamazService {
  constructor(private readonly prisma: PrismaService) {}

  async settings(userId: string): Promise<PrayerSettingsView> {
    return settingsView(await this.prisma.prayerSettings.findUnique({ where: { userId } }));
  }

  async updateSettings(userId: string, dto: UpdatePrayerSettingsDto): Promise<PrayerSettingsView> {
    const row = await this.prisma.prayerSettings.upsert({ where: { userId }, create: { userId, ...dto }, update: dto });
    return settingsView(row);
  }

  async qaza(userId: string): Promise<QazaView> {
    const today = dhakaDateOnly(new Date());
    const [settings, sheets] = await Promise.all([
      this.prisma.prayerSettings.findUnique({ where: { userId } }),
      this.prisma.habitMonthTracker.findMany({
        where: { userId, category: 'Namaz' },
        include: { checks: { select: { day: true, item: true, status: true } } },
        orderBy: [{ year: 'asc' }, { month: 'asc' }],
      }),
    ]);
    const first = sheets.find((sheet) => sheet.month !== null && sheet.year !== null);
    const since = settings?.qazaSince ?? (first ? new Date(Date.UTC(first.year!, first.month! - 1, 1)) : today);

    const missed = missedSince(sheets, since, today);
    const madeUp = zeroCounts();
    const made = await this.prisma.qazaLog.groupBy({ by: ['prayer'], where: { userId, date: { gte: since } }, _sum: { count: true } });
    for (const row of made) if (row.prayer in madeUp) madeUp[row.prayer] = row._sum.count ?? 0;
    const left = Object.fromEntries(Object.keys(missed).map((prayer) => [prayer, Math.max(0, missed[prayer] - madeUp[prayer])]));

    const recent = await this.prisma.qazaLog.findMany({ where: { userId }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: RECENT_LOGS });
    return {
      since: dayKey(since),
      missed,
      madeUp,
      left,
      totalLeft: Object.values(left).reduce((sum, count) => sum + count, 0),
      recent: recent.map((log) => ({ id: log.id, prayer: log.prayer, count: log.count, date: dayKey(log.date) })),
    };
  }

  async setSince(userId: string, dto: SetQazaSinceDto): Promise<QazaView> {
    const since = this.pastDay(dto.since);
    await this.prisma.prayerSettings.upsert({ where: { userId }, create: { userId, qazaSince: since }, update: { qazaSince: since } });
    return this.qaza(userId);
  }

  async logQaza(userId: string, dto: LogQazaDto): Promise<QazaView> {
    const date = dto.date ? this.pastDay(dto.date) : dhakaDateOnly(new Date());
    await this.prisma.qazaLog.create({ data: { userId, prayer: dto.prayer, count: dto.count ?? 1, date } });
    return this.qaza(userId);
  }

  async removeLog(userId: string, id: string): Promise<QazaView> {
    const { count } = await this.prisma.qazaLog.deleteMany({ where: { id, userId } });
    if (count === 0) throw new NotFoundException('Qaza entry not found');
    return this.qaza(userId);
  }

  // A real calendar day, today at the latest.
  private pastDay(key: string): Date {
    const date = new Date(`${key}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || dayKey(date) !== key) throw new BadRequestException('Not a calendar date');
    if (date > dhakaDateOnly(new Date())) throw new BadRequestException("That day hasn't come yet");
    return date;
  }
}
