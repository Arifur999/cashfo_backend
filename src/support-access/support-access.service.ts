import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { AuthSessionsService } from '../auth/auth-sessions.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

// How long a support code works, and how many wrong tries burn it.
export const SUPPORT_CODE_MINUTES = 15;
export const SUPPORT_CODE_TRIES = 5;

// A customer's consent to "View as customer": a 6-digit code they make in
// Settings and read out to support. Only its SHA-256 is kept, in
// better-auth's verification table under this identifier; it works once,
// for 15 minutes, and five wrong tries throw it away, so an admin can't open
// an account the customer didn't hand over -- and never learns a password.
export const supportCodeIdentifier = (userId: string) => `support-access:${userId}`;
const hashOf = (code: string) => createHash('sha256').update(code).digest('hex');

interface StoredCode {
  hash: string;
  tries: number;
}

const readStored = (value: string): StoredCode | null => {
  try {
    const parsed = JSON.parse(value) as Partial<StoredCode>;
    return typeof parsed.hash === 'string' && typeof parsed.tries === 'number' ? { hash: parsed.hash, tries: parsed.tries } : null;
  } catch {
    return null;
  }
};

const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export type ConsumeResult = 'ok' | 'none' | 'wrong';

@Injectable()
export class SupportAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: AuthSessionsService,
  ) {}

  // A fresh code, replacing any the customer made before.
  async create(userId: string) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = new Date(Date.now() + SUPPORT_CODE_MINUTES * 60 * 1000);
    const identifier = supportCodeIdentifier(userId);
    await this.prisma.$transaction([
      this.prisma.verification.deleteMany({ where: { identifier } }),
      this.prisma.verification.create({ data: { identifier, value: JSON.stringify({ hash: hashOf(code), tries: 0 }), expiresAt } }),
    ]);
    return { code, expiresAt };
  }

  // What Settings shows: whether a code is waiting, until when, and when
  // support last opened the account.
  async status(userId: string) {
    const [code, lastView, openViews] = await Promise.all([
      this.prisma.verification.findFirst({ where: { identifier: supportCodeIdentifier(userId), expiresAt: { gt: new Date() } }, select: { expiresAt: true } }),
      this.prisma.auditLog.findFirst({
        where: { action: 'USER_IMPERSONATION_STARTED', entityType: 'User', entityId: userId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      this.prisma.authSession.count({ where: { userId, impersonatedBy: { not: null }, expiresAt: { gt: new Date() } } }),
    ]);
    return { active: !!code, expiresAt: code?.expiresAt ?? null, lastViewedAt: lastView?.createdAt ?? null, viewOpen: openViews > 0 };
  }

  // Takes the code back and ends any support view open right now.
  async revoke(userId: string, ipAddress?: string) {
    await this.prisma.verification.deleteMany({ where: { identifier: supportCodeIdentifier(userId) } });
    const views = await this.prisma.authSession.findMany({
      where: { userId, impersonatedBy: { not: null } },
      select: { id: true, impersonatedBy: true },
    });
    for (const view of views) {
      await this.sessions.revoke(view.id);
    }
    // One row per admin whose view the customer closed.
    const admins = [...new Set(views.map((view) => view.impersonatedBy).filter((id): id is string => !!id))];
    for (const adminUserId of admins) {
      await this.prisma.auditLog.create({
        data: { adminUserId, action: 'USER_IMPERSONATION_ENDED', entityType: 'User', entityId: userId, newValue: { sensitive: true, endedBy: 'customer' }, ipAddress },
      });
    }
    return { ended: views.length };
  }

  // An admin's access to a customer's data (View as customer, Download a
  // copy) needs the code the customer made: used up when right; a missing or
  // wrong one is refused and the refusal goes in the audit log as `refused`.
  async requireConsent(userId: string, code: string, audit: { adminId: string; refused: string; ipAddress?: string }): Promise<void> {
    const consent = await this.consume(userId, code);
    if (consent === 'ok') return;
    await this.prisma.auditLog.create({
      data: {
        adminUserId: audit.adminId,
        action: audit.refused,
        entityType: 'User',
        entityId: userId,
        newValue: { sensitive: true, reason: consent === 'none' ? 'no-code' : 'wrong-code' },
        ipAddress: audit.ipAddress,
      },
    });
    throw new ForbiddenException(
      consent === 'none'
        ? 'There is no support code to use. Ask the customer to make one in Settings > Security.'
        : "That isn't the customer's support code. Check it with them and try again.",
    );
  }

  // The admin's side: 'ok' once for the right code in time (it is used up),
  // 'none' when there is no live code, 'wrong' otherwise -- and the fifth
  // wrong try throws the code away.
  async consume(userId: string, code: string): Promise<ConsumeResult> {
    // One check at a time per customer: tries sent together each count.
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`support-code:${userId}`}))`;
      return this.check(tx, userId, code);
    });
  }

  private async check(db: Prisma.TransactionClient, userId: string, code: string): Promise<ConsumeResult> {
    const row = await db.verification.findFirst({
      where: { identifier: supportCodeIdentifier(userId) },
      orderBy: { createdAt: 'desc' },
    });
    if (!row || row.expiresAt.getTime() <= Date.now()) return 'none';
    const stored = readStored(row.value);
    if (!stored) return 'none';

    if (sameHash(stored.hash, hashOf(code))) {
      // Deleting by id makes it single-use: of two requests racing with the
      // right code, only the one that deletes the row gets in.
      const { count } = await db.verification.deleteMany({ where: { id: row.id } });
      return count === 1 ? 'ok' : 'none';
    }

    const tries = stored.tries + 1;
    if (tries >= SUPPORT_CODE_TRIES) {
      await db.verification.deleteMany({ where: { id: row.id } });
    } else {
      await db.verification.updateMany({ where: { id: row.id }, data: { value: JSON.stringify({ ...stored, tries }) } });
    }
    return 'wrong';
  }
}
