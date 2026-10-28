import { Injectable, NotFoundException } from '@nestjs/common';
import { FlagStatus, Prisma, SuspiciousActivityType, UserStatus } from '@prisma/client';
import { ipCountry } from '../common/ip-country.js';
import { ADMIN_USER_WHERE, END_USER_WHERE } from '../common/roles.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ListFlagsQueryDto } from './dto/list-flags-query.dto.js';
import { UpdateFlagDto } from './dto/update-flag.dto.js';
import {
  failedSignInsDescription,
  type KnownAccount,
  locationDedupeKey,
  normalizeEmail,
  type PlacedSignIn,
  signInsFromNewCountries,
  unusualLocationDescription,
} from './security-extras.js';

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const FAILED_ATTEMPT_THRESHOLD = 5;

// Raised and not yet closed: what the Security tabs count as needing a look.
const NEEDS_A_LOOK: FlagStatus[] = [FlagStatus.OPEN, FlagStatus.REVIEWING];

// The audit action an admin's "Check now" writes. "Last checked" is the
// newer of the latest one and LAST_CHECK_KEY, which every run (the
// five-minute timer's too, which has no admin to audit) stamps.
export const SECURITY_CHECK_ACTION = 'SECURITY_CHECK_RUN';
export const LAST_CHECK_KEY = 'security_last_check_at';
// How far the unusual-location check has read the sign-in history. The
// first run looks back an hour; after that each run starts where the last
// one stopped, a batch at a time.
export const LOCATION_WATERMARK_KEY = 'security_location_watermark';
const LOCATION_BATCH = 500;

// A PlatformSetting holding an ISO time, or null.
const settingTime = (value: Prisma.JsonValue | undefined): Date | null => {
  if (typeof value !== 'string') return null;
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? null : time;
};

@Injectable()
export class SuspiciousActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListFlagsQueryDto) {
    const where: Prisma.SuspiciousActivityFlagWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.severity) where.severity = query.severity;

    const flags = await this.prisma.suspiciousActivityFlag.findMany({
      where,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });

    const adminIds = [...new Set([...flags.map((f) => f.relatedAdminId), ...flags.map((f) => f.reviewedBy)].filter((id): id is string => Boolean(id)))];
    const userIds = [...new Set(flags.map((f) => f.relatedUserId).filter((id): id is string => Boolean(id)))];
    const [admins, users] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: adminIds }, ...ADMIN_USER_WHERE }, select: { id: true, name: true } }),
      userIds.length > 0 ? this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }) : [],
    ]);
    const adminById = new Map(admins.map((a) => [a.id, a]));
    const userById = new Map(users.map((u) => [u.id, u]));

    return flags.map((flag) => ({
      ...flag,
      relatedAdmin: flag.relatedAdminId ? (adminById.get(flag.relatedAdminId) ?? null) : null,
      relatedUser: flag.relatedUserId ? (userById.get(flag.relatedUserId) ?? null) : null,
      reviewer: flag.reviewedBy ? (adminById.get(flag.reviewedBy) ?? null) : null,
    }));
  }

  // The count on the "Suspicious activity" tab and the "Last checked" time
  // beside "Check now".
  async summary() {
    const [needsLook, lastCheck, lastRun] = await Promise.all([
      this.prisma.suspiciousActivityFlag.count({ where: { status: { in: NEEDS_A_LOOK } } }),
      this.prisma.auditLog.findFirst({ where: { action: SECURITY_CHECK_ACTION }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      this.prisma.platformSetting.findUnique({ where: { key: LAST_CHECK_KEY }, select: { value: true } }),
    ]);
    const times = [lastCheck?.createdAt ?? null, settingTime(lastRun?.value)].filter((time): time is Date => time !== null);
    const lastCheckedAt = times.length > 0 ? new Date(Math.max(...times.map((time) => time.getTime()))) : null;
    return { needsLook, lastCheckedAt };
  }

  async updateStatus(id: string, dto: UpdateFlagDto, reviewerId: string, ipAddress?: string) {
    const flag = await this.prisma.suspiciousActivityFlag.findUnique({ where: { id } });
    if (!flag) {
      throw new NotFoundException('Flag not found');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.suspiciousActivityFlag.update({
        where: { id },
        data: { status: dto.status, reviewedBy: reviewerId, reviewedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          adminUserId: reviewerId,
          action: 'SECURITY_FLAG_UPDATED',
          entityType: 'SuspiciousActivityFlag',
          entityId: id,
          oldValue: { status: flag.status },
          newValue: { status: updated.status },
          ipAddress,
        },
      });
      return updated;
    });
  }

  // Runs every five minutes (SecurityHousekeeping) and on "Check now".
  // Failed sign-ins: scans the last 15 minutes, groups by IP, and flags any
  // IP with 5+ failures -- skipping IPs that already have a matching flag
  // raised within the last hour so re-running this doesn't spam duplicate
  // flags. Then the unusual-location check (detectUnusualLocations). An
  // admin's run is written to the audit log; every run stamps LAST_CHECK_KEY.
  async runDetection(adminId?: string, ipAddress?: string, now = new Date()) {
    const fifteenMinAgo = new Date(now.getTime() - FIFTEEN_MINUTES_MS);
    const oneHourAgo = new Date(now.getTime() - ONE_HOUR_MS);

    const recentFailures = await this.prisma.loginAttempt.findMany({
      where: { success: false, createdAt: { gte: fifteenMinAgo } },
      select: { ipAddress: true, email: true },
    });

    const byIp = new Map<string, { count: number; emails: Set<string> }>();
    for (const attempt of recentFailures) {
      const seen = byIp.get(attempt.ipAddress) ?? { count: 0, emails: new Set<string>() };
      seen.count += 1;
      seen.emails.add(normalizeEmail(attempt.email));
      byIp.set(attempt.ipAddress, seen);
    }

    const suspiciousIps = [...byIp.entries()].filter(([, seen]) => seen.count >= FAILED_ATTEMPT_THRESHOLD);
    const triedEmails = [...new Set(suspiciousIps.flatMap(([, seen]) => [...seen.emails]))];
    const accounts: Map<string, KnownAccount> = new Map(
      triedEmails.length > 0
        ? (
            await this.prisma.user.findMany({ where: { email: { in: triedEmails } }, select: { email: true, name: true, role: true, status: true } })
          ).map((account) => [account.email, account])
        : [],
    );

    let flagsCreated = 0;
    for (const [ip, seen] of suspiciousIps) {
      const existing = await this.prisma.suspiciousActivityFlag.findFirst({
        where: { type: SuspiciousActivityType.MULTIPLE_FAILED_LOGINS, relatedIp: ip, createdAt: { gte: oneHourAgo } },
      });
      if (existing) continue;

      await this.prisma.suspiciousActivityFlag.create({
        data: {
          type: SuspiciousActivityType.MULTIPLE_FAILED_LOGINS,
          description: failedSignInsDescription(ip, seen.count, [...seen.emails], accounts),
          relatedIp: ip,
          severity: 'HIGH',
          status: 'OPEN',
        },
      });
      flagsCreated++;
    }

    const location = await this.detectUnusualLocations(now);
    // flagsCreated: every new flag; the two checks' own counts beside it.
    const result = {
      scanned: recentFailures.length,
      ipsOverThreshold: suspiciousIps.length,
      failedLoginFlags: flagsCreated,
      signInsChecked: location.signInsChecked,
      locationFlags: location.flagsCreated,
      flagsCreated: flagsCreated + location.flagsCreated,
    };
    const stamp = now.toISOString();
    await this.prisma.platformSetting.upsert({ where: { key: LAST_CHECK_KEY }, update: { value: stamp }, create: { key: LAST_CHECK_KEY, value: stamp } });
    if (adminId) {
      await this.prisma.auditLog.create({
        data: { adminUserId: adminId, action: SECURITY_CHECK_ACTION, entityType: 'SuspiciousActivityFlag', newValue: result, ipAddress },
      });
    }
    return { ...result, checkedAt: now };
  }

  // UNUSUAL_LOGIN_LOCATION: a customer signed in from a country their
  // account has never signed in from before. Reads the successful sign-ins
  // since the last run (the watermark), places each IP with the bundled
  // country database (unplaceable ones -- private networks, test clients --
  // are skipped), and compares with the countries of the account's earlier
  // sign-ins. Only active customer accounts; an account with no placed
  // earlier sign-in has nothing to compare against yet. The dedupe key keeps
  // it to one flag per account and country, however often this runs.
  async detectUnusualLocations(now = new Date()) {
    const mark = await this.prisma.platformSetting.findUnique({ where: { key: LOCATION_WATERMARK_KEY }, select: { value: true } });
    const since = settingTime(mark?.value) ?? new Date(now.getTime() - ONE_HOUR_MS);
    const signIns = await this.prisma.loginAttempt.findMany({
      where: { success: true, createdAt: { gt: since, lte: now } },
      orderBy: { createdAt: 'asc' },
      take: LOCATION_BATCH,
      select: { email: true, ipAddress: true, createdAt: true },
    });
    // A full batch leaves the rest for the next run.
    const nextMark = (signIns.length === LOCATION_BATCH ? signIns[signIns.length - 1].createdAt : now).toISOString();

    const placedByEmail = new Map<string, PlacedSignIn[]>();
    for (const attempt of signIns) {
      const country = ipCountry(attempt.ipAddress);
      if (!country) continue;
      const email = normalizeEmail(attempt.email);
      const list = placedByEmail.get(email) ?? [];
      list.push({ ...country, ipAddress: attempt.ipAddress, createdAt: attempt.createdAt });
      placedByEmail.set(email, list);
    }

    let flagsCreated = 0;
    const emails = [...placedByEmail.keys()];
    if (emails.length > 0) {
      const [accounts, history] = await Promise.all([
        this.prisma.user.findMany({
          where: { email: { in: emails }, ...END_USER_WHERE, status: UserStatus.ACTIVE },
          select: { id: true, name: true, email: true },
        }),
        // Every distinct address each account signed in from before this batch.
        this.prisma.loginAttempt.findMany({
          where: { success: true, email: { in: emails }, createdAt: { lte: since } },
          distinct: ['email', 'ipAddress'],
          select: { email: true, ipAddress: true },
        }),
      ]);
      const earlierByEmail = new Map<string, Map<string, string>>();
      for (const row of history) {
        const country = ipCountry(row.ipAddress);
        if (!country) continue;
        const email = normalizeEmail(row.email);
        const countries = earlierByEmail.get(email) ?? new Map<string, string>();
        countries.set(country.code, country.name);
        earlierByEmail.set(email, countries);
      }

      const flags: Prisma.SuspiciousActivityFlagCreateManyInput[] = [];
      for (const account of accounts) {
        const found = signInsFromNewCountries(earlierByEmail.get(account.email) ?? new Map(), placedByEmail.get(account.email) ?? []);
        for (const { signIn, earlierCountries } of found) {
          flags.push({
            type: SuspiciousActivityType.UNUSUAL_LOGIN_LOCATION,
            description: unusualLocationDescription(account.name, account.email, signIn.name, earlierCountries),
            relatedUserId: account.id,
            relatedIp: signIn.ipAddress,
            severity: 'MEDIUM',
            status: 'OPEN',
            dedupeKey: locationDedupeKey(account.id, signIn.code),
          });
        }
      }
      if (flags.length > 0) {
        flagsCreated = (await this.prisma.suspiciousActivityFlag.createMany({ data: flags, skipDuplicates: true })).count;
      }
    }

    await this.prisma.platformSetting.upsert({
      where: { key: LOCATION_WATERMARK_KEY },
      update: { value: nextMark },
      create: { key: LOCATION_WATERMARK_KEY, value: nextMark },
    });
    return { signInsChecked: signIns.length, flagsCreated };
  }
}
