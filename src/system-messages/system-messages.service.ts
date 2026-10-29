import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type NotificationChannel, type NotificationLogStatus, type NotificationTemplate, type UserNotificationType } from '@prisma/client';
import { MailService, type EmailAttachment } from '../mail/mail.service.js';
import { recipientVariables, renderTemplate } from '../notifications/campaign-content.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SmsService } from '../sms/sms.service.js';

// The automatic messages an admin can word in Notifications > Templates.
// Each goes out on its template's own channel when the thing happens.
export type SystemMessageKey = 'welcome' | 'subscription_expiring' | 'payment_successful' | 'payment_failed' | 'ticket_reply';

// OFF: there is no such template, or it is switched off, and the caller
// sends its own built-in message as before. SENT or FAILED: the template was
// on and took that message's place; either way it is in Send history.
export type SystemOutcome = 'OFF' | 'SENT' | 'FAILED';

export interface SystemMessage {
  // Filled into the template's {{placeholders}}, on top of the person's own
  // (userName, firstName, planName, email, appName). A function gets the
  // person's language, for dates and amounts written in it.
  values?: Record<string, string> | ((language: 'EN' | 'BN') => Record<string, string>);
  // An email's "Open" link; the app's address when left out.
  link?: string;
  // An email's attachments (a receipt's invoice PDF), made only when it goes.
  attachments?: () => Promise<EmailAttachment[]>;
  // An in-app message's bell row: its key (one row per thing), its type and
  // data; the template's words are added as `body` (and `title`).
  bell?: { key: string; type: UserNotificationType; data: Record<string, string> };
}

const MAX_ERROR_CHARS = 500;
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, MAX_ERROR_CHARS);

// Sends an automatic message in the admin's wording when its template is on.
// Never throws: a message that can't go is logged as FAILED, and the thing
// that triggered it (a sign-up, a payment, a reply) carries on.
@Injectable()
export class SystemMessagesService {
  private readonly logger = new Logger(SystemMessagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly sms: SmsService,
    private readonly config: ConfigService,
  ) {}

  async send(key: SystemMessageKey, userId: string, message: SystemMessage = {}): Promise<SystemOutcome> {
    let template: NotificationTemplate | null;
    try {
      template = await this.prisma.notificationTemplate.findUnique({ where: { key } });
    } catch (error) {
      // Can't tell whether it is on: the built-in message goes, as before.
      this.logger.warn(`Could not read the ${key} template: ${errorText(error)}`);
      return 'OFF';
    }
    if (!template?.isActive) return 'OFF';

    let status: NotificationLogStatus = 'SENT';
    let errorMessage: string | null = null;
    try {
      await this.deliver(template, userId, message);
    } catch (error) {
      status = 'FAILED';
      errorMessage = errorText(error);
      this.logger.warn(`The ${key} message to user ${userId} failed: ${errorMessage}`);
    }
    await this.log(userId, key, template.channel, status, errorMessage);
    return status;
  }

  private async deliver(template: NotificationTemplate, userId: string, message: SystemMessage) {
    const person = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true, phone: true, phoneVerifiedAt: true, preferredLanguage: true, subscription: { select: { plan: { select: { name: true } } } } },
    });
    if (!person) throw new Error('No such user');
    const language = person.preferredLanguage;
    const appName = await this.mail.platformName();
    const own = recipientVariables({ name: person.name, email: person.email, planName: person.subscription?.plan.name ?? null }, appName);
    const extra = typeof message.values === 'function' ? message.values(language) : (message.values ?? {});
    const { subject, body } = renderTemplate(template, language, { ...own, ...extra });

    if (template.channel === 'EMAIL') {
      if (!this.mail.configured) throw new Error('Email is not set up (RESEND_API_KEY)');
      const link = message.link ?? this.config.get<string>('USER_FRONTEND_URL') ?? 'http://localhost:3000';
      const attachments = message.attachments ? await message.attachments() : undefined;
      await this.mail.sendTemplatedEmail(person.email, language === 'BN' ? 'bn' : 'en', { subject: subject ?? appName, body, link }, attachments);
    } else if (template.channel === 'SMS') {
      // Only a phone its owner proved, as campaigns do.
      if (!person.phone || !person.phoneVerifiedAt) throw new Error('No verified phone');
      await this.sms.send(person.phone, body, 'transactional');
    } else {
      if (!message.bell) throw new Error('This message has no place in the bell');
      await this.prisma.userNotification.createMany({
        data: [
          {
            userId,
            key: message.bell.key,
            type: message.bell.type,
            businessId: null,
            data: { ...message.bell.data, body, ...(subject && { title: subject }) } as Prisma.InputJsonObject,
          },
        ],
        skipDuplicates: true,
      });
    }
  }

  // Send history's row. A failed write never fails the message.
  private async log(userId: string, key: SystemMessageKey, channel: NotificationChannel, status: NotificationLogStatus, errorMessage: string | null) {
    try {
      await this.prisma.notificationLog.create({
        data: { platformUserId: userId, campaignId: null, templateKey: key, channel, status, sentAt: status === 'SENT' ? new Date() : null, errorMessage },
      });
    } catch (error) {
      this.logger.warn(`Could not log the ${key} message to user ${userId}: ${errorText(error)}`);
    }
  }
}
