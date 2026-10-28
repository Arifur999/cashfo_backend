import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import type { ClientInfo } from '../auth/auth-sessions.service.js';
import { localeOf } from '../billing/billing-text.js';
import { placeOfIp } from '../common/ip-country.js';
import { EmailVerificationService } from '../email-verification/email-verification.service.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { UpdateAlertsDto } from './dto/update-alerts.dto.js';
import {
  dhakaTimeLabel,
  FAILED_TRIES_ALERT_GAP_MS,
  FAILED_TRIES_WINDOW_MS,
  FAILED_TRY_REASONS,
  failedTriesAlertDue,
  failedTriesKey,
  isKnownDevice,
  SIGNUP_WINDOW_MS,
} from './security-alerts.js';

const ALERTS_SELECT = { alertNewDevice: true, alertFailedTries: true, askCodeBeforeReset: true } as const;

// A device row as UserSessionsService.record() just created it.
export interface NewSession {
  id: string;
  userId: string;
  deviceLabel: string;
  ipAddress: string;
  createdAt: Date;
}

// Settings > Security > Alerts: the switches, and the two alerts they turn
// on (a new device signed in; many wrong sign-in tries). Each alert is a
// bell row plus an email once Resend is set up. Both run after the sign-in
// has answered (fire-and-forget), so they never slow it down, fail it, or
// make a wrong password answer differently for a real account.
@Injectable()
export class SecurityAlertsService {
  private readonly logger = new Logger(SecurityAlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly verification: EmailVerificationService,
  ) {}

  // emailReady: whether the alerts can email yet; until then the app keeps
  // them marked "Coming soon".
  async settings(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: ALERTS_SELECT });
    return { ...user, emailReady: this.mail.configured };
  }

  async updateSettings(userId: string, dto: UpdateAlertsDto) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { alertNewDevice: dto.alertNewDevice, alertFailedTries: dto.alertFailedTries, askCodeBeforeReset: dto.askCodeBeforeReset },
    });
    return this.settings(userId);
  }

  // ---- After a new device row ----

  afterNewSession(session: NewSession): void {
    void this.newSession(session).catch((error: unknown) =>
      this.logger.warn(`New-device check for ${session.userId} failed: ${error instanceof Error ? error.message : String(error)}`),
    );
  }

  // The account's very first device is its signup: that one gets the email
  // verification link instead. Any later device with a label this account
  // never used before is "new".
  private async newSession(session: NewSession): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: session.userId },
      select: { id: true, name: true, email: true, role: true, status: true, preferredLanguage: true, alertNewDevice: true, createdAt: true },
    });
    if (!user || user.role !== Role.USER || user.status !== 'ACTIVE') return;

    const earlier = await this.prisma.userSession.findMany({
      where: { userId: user.id, id: { not: session.id } },
      select: { deviceLabel: true },
      distinct: ['deviceLabel'],
    });
    if (earlier.length === 0) {
      if (session.createdAt.getTime() - user.createdAt.getTime() < SIGNUP_WINDOW_MS) await this.verification.sendAfterSignup(user.id);
      return;
    }
    if (
      !user.alertNewDevice ||
      isKnownDevice(
        session.deviceLabel,
        earlier.map((row) => row.deviceLabel),
      )
    )
      return;

    const country = placeOfIp(session.ipAddress);
    await this.prisma.userNotification.createMany({
      data: [
        {
          userId: user.id,
          key: `new-device:${session.id}`,
          type: 'SECURITY',
          businessId: null,
          data: { event: 'NEW_DEVICE', deviceLabel: session.deviceLabel, ipAddress: session.ipAddress, country },
        },
      ],
      skipDuplicates: true,
    });
    if (!this.mail.configured) return;
    const locale = localeOf(user.preferredLanguage);
    await this.mail.sendNewDeviceEmail(user.email, locale, {
      name: user.name,
      deviceLabel: session.deviceLabel,
      place: country,
      ipAddress: session.ipAddress,
      time: dhakaTimeLabel(session.createdAt, locale),
      link: `${this.frontendUrl()}/settings/security`,
    });
  }

  // ---- After a wrong password or two-step code ----

  afterFailedTry(email: string, client: ClientInfo): void {
    void this.failedTry(email, client).catch((error: unknown) =>
      this.logger.warn(`Failed-tries check for ${email} failed: ${error instanceof Error ? error.message : String(error)}`),
    );
  }

  // Counts the account's wrong tries in the last 15 minutes; at five, the
  // warning goes, at most once an hour (claimed with a conditional update,
  // so parallel failures or two servers send it once).
  private async failedTry(email: string, client: ClientInfo): Promise<void> {
    const now = new Date();
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, name: true, email: true, role: true, status: true, preferredLanguage: true, alertFailedTries: true, failedTriesAlertedAt: true },
    });
    if (!user || user.role !== Role.USER || user.status !== 'ACTIVE' || !user.alertFailedTries) return;

    const count = await this.prisma.loginAttempt.count({
      where: { email, success: false, failureReason: { in: FAILED_TRY_REASONS }, createdAt: { gte: new Date(now.getTime() - FAILED_TRIES_WINDOW_MS) } },
    });
    if (!failedTriesAlertDue(count, user.failedTriesAlertedAt, now)) return;
    const { count: claimed } = await this.prisma.user.updateMany({
      where: {
        id: user.id,
        alertFailedTries: true,
        OR: [{ failedTriesAlertedAt: null }, { failedTriesAlertedAt: { lte: new Date(now.getTime() - FAILED_TRIES_ALERT_GAP_MS) } }],
      },
      data: { failedTriesAlertedAt: now },
    });
    if (claimed !== 1) return;

    const ipAddress = client.ipAddress ?? 'unknown';
    const country = placeOfIp(ipAddress);
    await this.prisma.userNotification.createMany({
      data: [{ userId: user.id, key: failedTriesKey(now), type: 'SECURITY', businessId: null, data: { event: 'FAILED_TRIES', count, ipAddress, country } }],
      skipDuplicates: true,
    });
    if (!this.mail.configured) return;
    const locale = localeOf(user.preferredLanguage);
    await this.mail.sendFailedTriesEmail(user.email, locale, {
      name: user.name,
      count,
      time: dhakaTimeLabel(now, locale),
      ipAddress,
      place: country,
      resetLink: `${this.frontendUrl()}/forgot-password`,
      securityLink: `${this.frontendUrl()}/settings/security`,
    });
  }

  private frontendUrl(): string {
    return this.config.get<string>('USER_FRONTEND_URL') ?? 'http://localhost:3000';
  }
}
