import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { DEFAULT_PLATFORM_NAME, SettingsService } from '../settings/settings.service.js';
import { renderPasswordResetEmail } from './templates/password-reset-email.js';
import { renderSupportReplyEmail } from './templates/support-reply-email.js';
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
