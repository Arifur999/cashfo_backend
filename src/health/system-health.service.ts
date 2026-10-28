import { randomUUID } from 'node:crypto';
import { readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentGateways } from '../billing/gateways/payment-gateways.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SmsService } from '../sms/sms.service.js';

export interface SystemHealth {
  // This answer came from a running server.
  api: 'up';
  // sizeBytes: the whole database on disk (null when it can't be read).
  database: { ok: boolean; latencyMs: number | null; sizeBytes: number | null };
  // configured: RESEND_API_KEY is set. lastSendAt/lastSendOk: this server's
  // most recent send (null before the first, or after a restart).
  email: { configured: boolean; lastSendAt: Date | null; lastSendOk: boolean | null };
  // configured: SMS_API_KEY and SMS_SENDER_ID are set (MRAM). balance: the
  // credit left in taka, asked at most every ten minutes (null when unknown).
  sms: { configured: boolean; lastSendAt: Date | null; lastSendOk: boolean | null; balance: number | null };
  // A real gateway (bKash, Nagad, SSLCommerz) is set up; without one,
  // payments are confirmed by hand (Mark paid).
  paymentGateway: { configured: boolean };
  // writable: the uploads folder main.ts serves at /uploads takes a file
  // (a test file is written and deleted). imageHostConfigured:
  // IMGBB_API_KEY is set -- photos, avatars and screenshots go to imgbb,
  // not this disk, and fail without it.
  // sizeBytes: what the uploads folder holds, counted at most every ten
  // minutes (null when it can't be read).
  storage: { writable: boolean; path: string; imageHostConfigured: boolean; sizeBytes: number | null };
}

const SIZE_EVERY_MS = 10 * 60 * 1000;
// Past this many files the count stops: a rough size is enough here.
const MAX_FILES = 50_000;

// The bytes a folder holds, its subfolders included.
export async function folderSize(dir: string, budget = { files: MAX_FILES }): Promise<number> {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (budget.files-- <= 0) break;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) total += await folderSize(path, budget);
    else if (entry.isFile()) total += (await stat(path)).size;
  }
  return total;
}

// The folder main.ts serves at /uploads (a Docker volume in production).
export const UPLOADS_DIR = 'uploads';

// Whether a folder takes a new file: writes a small one and deletes it.
export async function isWritable(dir: string): Promise<boolean> {
  const probe = join(dir, `.health-${randomUUID()}`);
  try {
    await writeFile(probe, 'ok', { flag: 'wx' });
    await unlink(probe);
    return true;
  } catch {
    return false;
  }
}

// What the admin dashboard's System list and the System page's health cards
// show: whether the database answers and how fast, and whether email and a
// payment gateway are set up, and whether file storage works.
@Injectable()
export class SystemHealthService {
  private storageSize: { at: number; bytes: number | null } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly gateways: PaymentGateways,
    private readonly config: ConfigService,
    private readonly sms: SmsService,
  ) {}

  async status(): Promise<SystemHealth> {
    const started = Date.now();
    let database: SystemHealth['database'];
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = { ok: true, latencyMs: Date.now() - started, sizeBytes: null };
      const [{ bytes }] = await this.prisma.$queryRaw<{ bytes: bigint }[]>`SELECT pg_database_size(current_database()) AS "bytes"`;
      database.sizeBytes = Number(bytes);
    } catch {
      database ??= { ok: false, latencyMs: null, sizeBytes: null };
    }
    const last = this.mail.lastSend;
    const lastSms = this.sms.lastSend;
    const uploads = join(process.cwd(), UPLOADS_DIR);
    const writable = await isWritable(uploads);
    if (!this.storageSize || Date.now() - this.storageSize.at > SIZE_EVERY_MS) {
      this.storageSize = { at: Date.now(), bytes: await folderSize(uploads).catch(() => null) };
    }
    return {
      api: 'up',
      database,
      email: { configured: this.mail.configured, lastSendAt: last?.at ?? null, lastSendOk: last?.ok ?? null },
      sms: { configured: this.sms.configured, lastSendAt: lastSms?.at ?? null, lastSendOk: lastSms?.ok ?? null, balance: await this.sms.balance() },
      paymentGateway: { configured: this.gateways.anyConfigured() },
      storage: { writable, path: UPLOADS_DIR, imageHostConfigured: Boolean(this.config.get<string>('IMGBB_API_KEY')), sizeBytes: this.storageSize.bytes },
    };
  }
}
