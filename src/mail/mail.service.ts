import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  // Overrides MAIL_FROM for this one send -- most callers don't need this.
  from?: string;
}

// Shared/cross-cutting, same shape as ImgbbService (src/uploads/) -- any
// feature module that needs to send a transactional email imports MailModule
// and injects this rather than instantiating its own Resend client. Client
// is created lazily so a missing RESEND_API_KEY only breaks send(), not app
// boot (mirrors ImgbbService's own missing-key handling).
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private client: Resend | null = null;

  constructor(private readonly configService: ConfigService) {}

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
