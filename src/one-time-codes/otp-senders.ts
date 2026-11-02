import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OneTimeCodeChannel } from '@prisma/client';
import { MailService } from '../mail/mail.service.js';
import { SmsService } from '../sms/sms.service.js';

export interface OtpMessage {
  name: string;
  // What the code confirms, worded per language ("withdraw ৳ 1,000 to bKash").
  action: { en: string; bn: string };
  locale: 'en' | 'bn';
  minutes: number;
}

// Where one-time codes go: SMS (MRAM) to a verified phone, or email (Resend).
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

// The code's text message: short enough for one SMS part in either
// language (the app's dialog already says what the code confirms).
export const otpSmsText = (platform: string, code: string, message: Pick<OtpMessage, 'locale' | 'minutes'>) =>
  message.locale === 'bn'
    ? `${platform} কোড ${code}। ${toBanglaDigits(message.minutes)} মিনিট কাজ করবে। কাউকে বলবেন না।`
    : `Your ${platform} code is ${code}. It works for ${message.minutes} minutes. Don't share it with anyone.`;

const toBanglaDigits = (value: number) => String(value).replace(/\d/g, (digit) => '০১২৩৪৫৬৭৮৯'[Number(digit)]);

// Text messages through MRAM (SmsService), once SMS_API_KEY and
// SMS_SENDER_ID are set.
@Injectable()
export class SmsOtpSender implements OtpSender {
  readonly channel = 'SMS' as const;

  constructor(
    private readonly sms: SmsService,
    private readonly mail: MailService,
  ) {}

  isConfigured() {
    return this.sms.configured;
  }

  async send(destination: string, code: string, message: OtpMessage) {
    await this.sms.send(destination, otpSmsText(await this.mail.platformName(), code, message));
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

// The person a code goes to. Only a phone they proved is theirs
// (phoneVerifiedAt) gets codes by SMS: anyone signed in can type a number.
export interface OtpPerson {
  email: string;
  phone: string | null;
  phoneVerifiedAt?: Date | null;
}

// SMS when it is set up and the person has a verified phone; otherwise
// email; otherwise (development) the log. Null: nothing can send a code.
@Injectable()
export class OtpSenders {
  constructor(
    private readonly sms: SmsOtpSender,
    private readonly email: EmailOtpSender,
    private readonly devLog: DevLogOtpSender,
  ) {}

  pick(person: OtpPerson): { sender: OtpSender; destination: string } | null {
    if (person.phone && person.phoneVerifiedAt && this.sms.isConfigured()) return { sender: this.sms, destination: person.phone };
    if (this.email.isConfigured()) return { sender: this.email, destination: person.email };
    if (this.devLog.isConfigured()) return { sender: this.devLog, destination: person.email };
    return null;
  }

  // A code that must go to this phone by SMS (proving the number is
  // theirs); null when SMS isn't set up.
  smsTo(phone: string): { sender: OtpSender; destination: string } | null {
    return this.sms.isConfigured() ? { sender: this.sms, destination: phone } : null;
  }

  // A code that goes by email whatever else is set up (one asked for often,
  // like the vault's unlock code, where a text message would cost each time).
  emailTo(email: string): { sender: OtpSender; destination: string } | null {
    if (this.email.isConfigured()) return { sender: this.email, destination: email };
    return this.devLog.isConfigured() ? { sender: this.devLog, destination: email } : null;
  }

  // The sender for a code already sent on `channel` (a resend goes the same way).
  forChannel(channel: OneTimeCodeChannel): OtpSender | null {
    if (channel === 'SMS') return this.sms.isConfigured() ? this.sms : null;
    if (this.email.isConfigured()) return this.email;
    return this.devLog.isConfigured() ? this.devLog : null;
  }
}
