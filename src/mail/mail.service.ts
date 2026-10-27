import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { DEFAULT_PLATFORM_NAME, SettingsService } from '../settings/settings.service.js';
import { renderAdminInviteEmail, type AdminInviteEmail } from './templates/admin-invite-email.js';
import { renderAdminPasswordResetEmail, type AdminPasswordResetEmail } from './templates/admin-password-reset-email.js';
import { renderBillingReceiptEmail, type ReceiptEmail } from './templates/billing-receipt-email.js';
import { renderOneTimeCodeEmail, type OneTimeCodeEmail } from './templates/one-time-code-email.js';
import { renderPasswordResetEmail } from './templates/password-reset-email.js';
import { renderPayoutNoticeEmail, type PayoutNotice } from './templates/payout-notice-email.js';
import { renderPlanNoticeEmail, type PlanNotice } from './templates/plan-notice-email.js';
import { renderSupportReplyEmail } from './templates/support-reply-email.js';
import { renderTwoStepNoticeEmail, type TwoStepNotice } from './templates/two-step-notice-email.js';
import { renderWelcomeEmail } from './templates/welcome-email.js';

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  // Overrides MAIL_FROM for this one send -- most callers don't need this.
  from?: string;
}

// The product's old name. A database whose platform_name row still holds it
// signs emails as DEFAULT_PLATFORM_NAME instead.
const LEGACY_PLATFORM_NAME = 'Money Management Tracker';

// Shared/cross-cutting, same shape as ImgbbService (src/uploads/) -- any
// feature module that needs to send a transactional email imports MailModule
// and injects this rather than instantiating its own Resend client. Client
// is created lazily so a missing RESEND_API_KEY only breaks send(), not app
// boot (mirrors ImgbbService's own missing-key handling).
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private client: Resend | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly settingsService: SettingsService,
  ) {}

  // The name emails greet and sign off with: the admin's platform name
  // setting, or DEFAULT_PLATFORM_NAME when it is blank, still the old name,
  // or can't be read (a settings hiccup must not stop an email).
  async platformName(): Promise<string> {
    try {
      const name = (await this.settingsService.getCached()).platformName?.trim();
      if (name && name !== LEGACY_PLATFORM_NAME) return name;
    } catch (err: unknown) {
      this.logger.warn(`Could not read the platform name for an email: ${err instanceof Error ? err.message : String(err)}`);
    }
    return DEFAULT_PLATFORM_NAME;
  }

  async sendWelcomeEmail(to: string, name: string): Promise<void> {
    await this.sendEmail({ to, ...renderWelcomeEmail(name, await this.platformName()) });
  }

  async sendPasswordResetEmail(to: string, name: string, resetUrl: string): Promise<void> {
    await this.sendEmail({ to, ...renderPasswordResetEmail(name, resetUrl, await this.platformName()) });
  }

  async sendSupportReplyEmail(to: string, name: string, subject: string, reply: string, link: string): Promise<void> {
    await this.sendEmail({ to, ...renderSupportReplyEmail(name, subject, reply, link, await this.platformName()) });
  }

  async sendBillingReceiptEmail(to: string, locale: 'en' | 'bn', receipt: ReceiptEmail): Promise<void> {
    await this.sendEmail({ to, ...renderBillingReceiptEmail(locale, receipt, await this.platformName()) });
  }

  async sendPlanNoticeEmail(to: string, locale: 'en' | 'bn', notice: PlanNotice): Promise<void> {
    await this.sendEmail({ to, ...renderPlanNoticeEmail(locale, notice, await this.platformName()) });
  }

  async sendOneTimeCodeEmail(to: string, locale: 'en' | 'bn', email: OneTimeCodeEmail): Promise<void> {
    await this.sendEmail({ to, ...renderOneTimeCodeEmail(locale, email, await this.platformName()) });
  }

  async sendPayoutNoticeEmail(to: string, locale: 'en' | 'bn', notice: PayoutNotice): Promise<void> {
    await this.sendEmail({ to, ...renderPayoutNoticeEmail(locale, notice, await this.platformName()) });
  }

  async sendTwoStepNoticeEmail(to: string, locale: 'en' | 'bn', notice: TwoStepNotice): Promise<void> {
    await this.sendEmail({ to, ...renderTwoStepNoticeEmail(locale, notice, await this.platformName()) });
  }

  // The two admin emails that carry a link someone must open (an invite, a
  // password reset). In development they can be logged instead (devLog).
  async sendAdminInviteEmail(to: string, invite: AdminInviteEmail): Promise<void> {
    await this.sendOrLog({ to, ...renderAdminInviteEmail(invite, await this.platformName()) }, `Admin invite link for ${to}: ${invite.link}`);
  }

  async sendAdminPasswordResetEmail(to: string, locale: 'en' | 'bn', email: AdminPasswordResetEmail): Promise<void> {
    await this.sendOrLog(
      { to, ...renderAdminPasswordResetEmail(locale, email, await this.platformName()) },
      `Admin password reset link for ${to}: ${email.link}`,
    );
  }

  // Whether sendEmail() can work at all (RESEND_API_KEY is set).
  get configured(): boolean {
    return Boolean(this.configService.get<string>('RESEND_API_KEY'));
  }

  // Development only: with OTP_DEV_LOG=1 (never in production) and no
  // RESEND_API_KEY, link emails are written to the server log instead, the
  // same switch the one-time codes use, so the flows can be tried locally.
  get devLog(): boolean {
    return !this.configured && this.configService.get<string>('NODE_ENV') !== 'production' && this.configService.get<string>('OTP_DEV_LOG') === '1';
  }

  // Whether a link email reaches the person one way or the other.
  get canDeliver(): boolean {
    return this.configured || this.devLog;
  }

  private async sendOrLog(options: SendEmailOptions, devLine: string): Promise<void> {
    if (this.devLog) {
      this.logger.warn(`${devLine} (OTP_DEV_LOG=1, not sent)`);
      return;
    }
    await this.sendEmail(options);
  }

  async sendEmail(options: SendEmailOptions): Promise<void> {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    if (!apiKey) {
      throw new InternalServerErrorException('Email sending is not configured (RESEND_API_KEY missing)');
    }
    this.client ??= new Resend(apiKey);

    const from = options.from ?? this.configService.get<string>('MAIL_FROM') ?? 'onboarding@resend.dev';
    const { error } = await this.client.emails.send({
      from,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });

    if (error) {
      const recipients = Array.isArray(options.to) ? options.to.join(', ') : options.to;
      this.logger.error(`Failed to send email to ${recipients}: ${error.message}`);
      throw new InternalServerErrorException('Failed to send email');
    }
  }
}
