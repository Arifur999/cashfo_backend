import { randomUUID } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentGateways } from '../billing/gateways/payment-gateways.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface SystemHealth {
  // This answer came from a running server.
  api: 'up';
  database: { ok: boolean; latencyMs: number | null };
  // configured: RESEND_API_KEY is set. lastSendAt/lastSendOk: this server's
  // most recent send (null before the first, or after a restart).
  email: { configured: boolean; lastSendAt: Date | null; lastSendOk: boolean | null };
  // A real gateway (bKash, Nagad, SSLCommerz) is set up; without one,
  // payments are confirmed by hand (Mark paid).
  paymentGateway: { configured: boolean };
  // writable: the uploads folder main.ts serves at /uploads takes a file
  // (a test file is written and deleted). imageHostConfigured:
  // IMGBB_API_KEY is set -- photos, avatars and screenshots go to imgbb,
  // not this disk, and fail without it.
  storage: { writable: boolean; path: string; imageHostConfigured: boolean };
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly gateways: PaymentGateways,
    private readonly config: ConfigService,
  ) {}

  async status(): Promise<SystemHealth> {
    const started = Date.now();
    let database: SystemHealth['database'];
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = { ok: true, latencyMs: Date.now() - started };
    } catch {
      database = { ok: false, latencyMs: null };
    }
    const last = this.mail.lastSend;
    const writable = await isWritable(join(process.cwd(), UPLOADS_DIR));
    return {
      api: 'up',
      database,
      email: { configured: this.mail.configured, lastSendAt: last?.at ?? null, lastSendOk: last?.ok ?? null },
      paymentGateway: { configured: this.gateways.anyConfigured() },
      storage: { writable, path: UPLOADS_DIR, imageHostConfigured: Boolean(this.config.get<string>('IMGBB_API_KEY')) },
    };
  }
}
