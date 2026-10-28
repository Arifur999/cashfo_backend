import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OneTimeCodeChannel } from '@prisma/client';
import { MailService } from '../mail/mail.service.js';

export interface OtpMessage {
  name: string;
  // What the code confirms, worded per language ("withdraw ৳ 1,000 to bKash").
  action: { en: string; bn: string };
  locale: 'en' | 'bn';
  minutes: number;
}

// Where one-time codes go. Email (Resend) works today; SMS is a seam that
// stays off until a provider is wired in.
export interface OtpSender {
  channel: OneTimeCodeChannel;
  isConfigured(): boolean;
  send(destination: string, code: string, message: OtpMessage): Promise<void>;
}

@Injectable()
export class EmailOtpSender implements OtpSender {
  readonly channel = 'EMAIL' as const;

  constructor(private readonly mail: MailService) {}

  isConfigured() {
    return this.mail.configured;
  }

  async send(destination: string, code: string, message: OtpMessage) {
    await this.mail.sendOneTimeCodeEmail(destination, message.locale, {
      name: message.name,
      code,
      action: message.action[message.locale],
      minutes: message.minutes,
    });
  }
}

// No SMS provider yet: never configured, so codes go by email. A provider
// (SSL Wireless, Twilio, ...) plugs in here.
@Injectable()
export class SmsOtpSender implements OtpSender {
  readonly channel = 'SMS' as const;

  isConfigured() {
    return false;
  }

  send(): Promise<void> {
    return Promise.reject(new Error('No SMS provider is configured'));
  }
}

// Development only: with OTP_DEV_LOG=1 (never in production) and no email
// set up, the code is written to the server log instead, so the flow can be
// tried locally and in e2e tests.
@Injectable()
export class DevLogOtpSender implements OtpSender {
  readonly channel = 'EMAIL' as const;
  private readonly logger = new Logger('OneTimeCode');

  constructor(private readonly config: ConfigService) {}

  isConfigured() {
    return this.config.get<string>('NODE_ENV') !== 'production' && this.config.get<string>('OTP_DEV_LOG') === '1';
  }

  send(destination: string, code: string) {
    this.logger.warn(`One-time code for ${destination}: ${code} (OTP_DEV_LOG=1, not sent)`);
    return Promise.resolve();
  }
}

// SMS when a provider is set up and the person has a phone; otherwise
// email; otherwise (development) the log. Null: nothing can send a code.
@Injectable()
export class OtpSenders {
  constructor(
    private readonly sms: SmsOtpSender,
    private readonly email: EmailOtpSender,
    private readonly devLog: DevLogOtpSender,
  ) {}

  pick(person: { email: string; phone: string | null }): { sender: OtpSender; destination: string } | null {
    if (person.phone && this.sms.isConfigured()) return { sender: this.sms, destination: person.phone };
    if (this.email.isConfigured()) return { sender: this.email, destination: person.email };
    if (this.devLog.isConfigured()) return { sender: this.devLog, destination: person.email };
    return null;
  }

  // The sender for a code already sent on `channel` (a resend goes the same way).
  forChannel(channel: OneTimeCodeChannel): OtpSender | null {
    if (channel === 'SMS') return this.sms.isConfigured() ? this.sms : null;
    if (this.email.isConfigured()) return this.email;
    return this.devLog.isConfigured() ? this.devLog : null;
  }
}
