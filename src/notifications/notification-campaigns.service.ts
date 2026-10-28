import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BulkNotificationCampaign, CampaignStatus, NotificationLogStatus, NotificationTemplate, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PushService } from '../push/push.service.js';
import { audienceWhere, campaignFilterOf, recipientVariables, renderTemplate, STALE_SEND_MS, type CampaignFilter } from './campaign-content.js';
import { CreateCampaignDto } from './dto/create-campaign.dto.js';

const SENDABLE_STATUSES: CampaignStatus[] = ['DRAFT', 'SCHEDULED'];
// People read per round: an in-app round is one insert, an email round one
// Resend batch request (it takes up to 100).
const IN_APP_ROUND = 500;
const EMAIL_ROUND = 50;
// Between email rounds, to stay under Resend's default 2 requests a second.
const EMAIL_PAUSE_MS = 600;
// "Send now" answers once the send is done, or after this long with the
// counts so far; the rest carries on in the background.
const ANSWER_WITHIN_MS = 20_000;
// A web push shows a line or two; a long message is cut for it (the bell
// has the whole text).
const PUSH_BODY_CHARS = 240;
const MAX_ERROR_CHARS = 500;
// Due campaigns started per timer tick.
const DUE_PER_TICK = 10;

const RECIPIENT_SELECT = {
  id: true,
  name: true,
  email: true,
  preferredLanguage: true,
  subscription: { select: { plan: { select: { name: true } } } },
  ownedBusinesses: { where: { isDefault: true, deletedAt: null }, take: 1, select: { plan: { select: { name: true } } } },
} satisfies Prisma.UserSelect;

type Person = Prisma.UserGetPayload<{ select: typeof RECIPIENT_SELECT }>;
type Outcome = { userId: string; status: NotificationLogStatus; errorMessage: string | null };

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms).unref();
  });

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, MAX_ERROR_CHARS);

const planNameOf = (person: Person) => person.subscription?.plan.name ?? person.ownedBusinesses[0]?.plan?.name ?? null;

const notConfigured = (reason: 'EMAIL_NOT_CONFIGURED' | 'SMS_NOT_CONFIGURED') =>
  new ServiceUnavailableException({
    statusCode: 503,
    error: 'Service Unavailable',
    message:
      reason === 'EMAIL_NOT_CONFIGURED'
        ? 'Email is not set up for the platform yet (RESEND_API_KEY), so this campaign cannot be sent.'
        : 'No SMS provider is set up yet, so SMS campaigns cannot be sent. Use email or in-app instead.',
    reason,
  });

// Admin campaigns (Notifications > Campaigns): one template to everyone a
// filter matches, by email, in-app (the bell plus web push) or SMS. Only
// ACTIVE customers get one. Every person gets a NotificationLog row, which
// is also how a send that stopped part-way (a restart) resumes without
// sending anyone a second copy.
//
// A campaign goes DRAFT/SCHEDULED -> SENDING -> SENT. The move to SENDING is
// an updateMany guarded on the old status, so two sends can't both run.
// While SENDING, sentAt is the send's heartbeat (moved after each round);
// a send whose heartbeat is older than STALE_SEND_MS has stopped and is
// picked up again by the timer or by "Send now". Once SENT, sentAt is when
// it finished.
@Injectable()
export class NotificationCampaignsService {
  private readonly logger = new Logger(NotificationCampaignsService.name);
  // Sends running in this process, so a tick never starts one twice here.
  private readonly running = new Set<string>();
  // Scheduled campaigns that can't go yet (template off, email not set up),
  // warned about once per process rather than every tick.
  private readonly warned = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly push: PushService,
    private readonly config: ConfigService,
  ) {}

  // Each campaign with how many people its filter reaches right now:
  // audienceCount by the filter as written (its status rule included),
  // reachableCount the ACTIVE ones a send would actually reach. Reading the
  // list also starts any scheduled campaign that is due (the timer does too).
  async list() {
    await this.sendDue(new Date()).catch((error: unknown) => this.logger.warn(`Starting due campaigns failed: ${errorText(error)}`));
    const campaigns = await this.prisma.bulkNotificationCampaign.findMany({ orderBy: { createdAt: 'desc' } });
    return Promise.all(campaigns.map((campaign) => this.withAudience(campaign)));
  }

  // How many customers a target filter reaches. With `sending`, only the
  // ACTIVE ones a send would reach.
  audienceCount(filter: CampaignFilter | Record<string, unknown>, sending = false): Promise<number> {
    return this.prisma.user.count({ where: audienceWhere(campaignFilterOf(filter), new Date(), sending) });
  }

  async create(dto: CreateCampaignDto, adminId: string) {
    const template = await this.prisma.notificationTemplate.findUnique({ where: { key: dto.templateKey } });
    if (!template) {
      throw new NotFoundException('Notification template not found');
    }

    const campaign = await this.prisma.bulkNotificationCampaign.create({
      data: {
        title: dto.title,
        templateKey: dto.templateKey,
        // Only the known rules are kept (campaignFilterOf()).
        targetFilter: campaignFilterOf(dto.targetFilter) as Prisma.InputJsonObject,
        channel: dto.channel,
        status: dto.scheduledFor ? 'SCHEDULED' : 'DRAFT',
        scheduledFor: dto.scheduledFor ? new Date(dto.scheduledFor) : null,
        createdBy: adminId,
      },
    });
    return this.withAudience(campaign);
  }

  // "Send now". Answers with the campaign and its counts once the send is
  // done, or after ANSWER_WITHIN_MS still SENDING, with the counts so far.
  async send(id: string, adminId: string, ipAddress?: string) {
    const campaign = await this.requireCampaign(id);
    const now = new Date();
    if (campaign.status === 'SENDING') {
      if (!this.isStalled(campaign, now)) throw new ConflictException('This campaign is being sent right now');
    } else if (!SENDABLE_STATUSES.includes(campaign.status)) {
      throw new BadRequestException('Only DRAFT or SCHEDULED campaigns can be sent');
    }

    const template = await this.readyTemplate(campaign);
    const claimed = await this.claim(campaign, now);
    if (!claimed) throw new ConflictException('This campaign is being sent right now');

    const run = this.deliver(claimed, template, { adminId, ipAddress }, campaign.status);
    await Promise.race([run, sleep(ANSWER_WITHIN_MS)]);
    return this.withAudience(await this.requireCampaign(id));
  }

  // The timer's job (every five minutes), and run lazily by list(): starts
  // each SCHEDULED campaign whose time has come, and picks up any send that
  // stalled. The sends run in the background, outside the timer's tick.
  async sendDue(now: Date): Promise<void> {
    const due = await this.prisma.bulkNotificationCampaign.findMany({
      where: {
        OR: [
          { status: 'SCHEDULED', scheduledFor: { lte: now } },
          { status: 'SENDING', OR: [{ sentAt: null }, { sentAt: { lt: new Date(now.getTime() - STALE_SEND_MS) } }] },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: DUE_PER_TICK,
    });
    for (const campaign of due) {
      if (this.running.has(campaign.id)) continue;
      let template: NotificationTemplate;
      try {
        template = await this.readyTemplate(campaign);
      } catch (error) {
        if (!this.warned.has(campaign.id)) {
          this.warned.add(campaign.id);
          this.logger.warn(`Campaign ${campaign.id} is due but can't be sent yet: ${errorText(error)}`);
        }
        continue;
      }
      const claimed = await this.claim(campaign, now);
      if (claimed) void this.deliver(claimed, template, null, campaign.status);
    }
  }

  async cancel(id: string, adminId: string, ipAddress?: string) {
    const campaign = await this.requireCampaign(id);
    if (!SENDABLE_STATUSES.includes(campaign.status)) {
      throw new BadRequestException('Only DRAFT or SCHEDULED campaigns can be cancelled');
    }

    // Guarded on the status read above: a timer that started the send in
    // between wins, and the cancel is refused.
    const { count } = await this.prisma.bulkNotificationCampaign.updateMany({ where: { id, status: campaign.status }, data: { status: 'CANCELLED' } });
    if (count === 0) throw new ConflictException('This campaign has just started sending');
    const result = await this.requireCampaign(id);

    await this.prisma.auditLog.create({
      data: {
        adminUserId: adminId,
        action: 'CAMPAIGN_CANCELLED',
        entityType: 'BulkNotificationCampaign',
        entityId: id,
        oldValue: { status: campaign.status },
        newValue: { status: 'CANCELLED' },
        ipAddress,
      },
    });

    return result;
  }

  private async withAudience(campaign: BulkNotificationCampaign) {
    const filter = campaignFilterOf(campaign.targetFilter);
    const [audienceCount, reachableCount] = await Promise.all([this.audienceCount(filter), this.audienceCount(filter, true)]);
    return { ...campaign, audienceCount, reachableCount };
  }

  private isStalled(campaign: BulkNotificationCampaign, now: Date) {
    return !this.running.has(campaign.id) && (!campaign.sentAt || campaign.sentAt.getTime() < now.getTime() - STALE_SEND_MS);
  }

  // The template, if it can go out on the campaign's channel now.
  private async readyTemplate(campaign: BulkNotificationCampaign): Promise<NotificationTemplate> {
    const template = await this.prisma.notificationTemplate.findUnique({ where: { key: campaign.templateKey } });
    if (!template) throw new NotFoundException('Notification template not found');
    if (!template.isActive) throw new BadRequestException('This template is switched off. Turn it on before sending.');
    if (campaign.channel === 'EMAIL' && !this.mail.configured) throw notConfigured('EMAIL_NOT_CONFIGURED');
    // There is no SMS provider; the one-time codes' SMS seam
    // (SmsOtpSender) is off too and only sends codes.
    if (campaign.channel === 'SMS') throw notConfigured('SMS_NOT_CONFIGURED');
    return template;
  }

  // Moves the campaign to SENDING (or takes over a stalled send), guarded on
  // what was read, so only one caller wins. Null when someone else did.
  private async claim(campaign: BulkNotificationCampaign, now: Date): Promise<BulkNotificationCampaign | null> {
    if (this.running.has(campaign.id)) return null;
    const where: Prisma.BulkNotificationCampaignWhereInput =
      campaign.status === 'SENDING'
        ? { id: campaign.id, status: 'SENDING', OR: [{ sentAt: null }, { sentAt: { lt: new Date(now.getTime() - STALE_SEND_MS) } }] }
        : { id: campaign.id, status: campaign.status };
    const { count } = await this.prisma.bulkNotificationCampaign.updateMany({ where, data: { status: 'SENDING', sentAt: now } });
    return count === 0 ? null : { ...campaign, status: 'SENDING', sentAt: now };
  }

  // Sends to everyone the filter reaches who has no log row for this
  // campaign yet, round by round, then marks it SENT with the final counts.
  // Never throws: a send that fails part-way stays SENDING and is picked up
  // again once stalled.
  private async deliver(
    campaign: BulkNotificationCampaign,
    template: NotificationTemplate,
    by: { adminId: string; ipAddress?: string } | null,
    fromStatus: CampaignStatus,
  ): Promise<void> {
    this.running.add(campaign.id);
    try {
      const startedAt = new Date();
      const where = audienceWhere(campaignFilterOf(campaign.targetFilter), startedAt, true);
      const appName = await this.mail.platformName();
      const logged = await this.prisma.notificationLog.findMany({ where: { campaignId: campaign.id }, select: { platformUserId: true } });
      const done = new Set(logged.map((row) => row.platformUserId));
      const round = campaign.channel === 'EMAIL' ? EMAIL_ROUND : IN_APP_ROUND;

      let cursor: string | undefined;
      for (;;) {
        const people = await this.prisma.user.findMany({
          where,
          orderBy: { id: 'asc' },
          take: round,
          ...(cursor && { cursor: { id: cursor }, skip: 1 }),
          select: RECIPIENT_SELECT,
        });
        if (people.length === 0) break;
        cursor = people[people.length - 1].id;

        const todo = people.filter((person) => !done.has(person.id));
        if (todo.length > 0) {
          const outcomes =
            campaign.channel === 'EMAIL' ? await this.sendEmails(campaign, template, todo, appName) : await this.sendInApp(campaign, template, todo, appName);
          await this.record(campaign, outcomes);
          if (campaign.channel === 'EMAIL') await sleep(EMAIL_PAUSE_MS);
        }
        if (people.length < round) break;
      }

      const byStatus = await this.prisma.notificationLog.groupBy({ by: ['status'], where: { campaignId: campaign.id }, _count: true });
      const sentCount = byStatus.find((row) => row.status === 'SENT')?._count ?? 0;
      const failedCount = byStatus.find((row) => row.status === 'FAILED')?._count ?? 0;
      await this.prisma.bulkNotificationCampaign.update({ where: { id: campaign.id }, data: { status: 'SENT', sentAt: new Date(), sentCount, failedCount } });
      await this.auditSent(campaign, by, fromStatus, sentCount, failedCount);
    } catch (error) {
      this.logger.warn(`Campaign ${campaign.id} stopped part-way and will be picked up again: ${errorText(error)}`);
    } finally {
      this.running.delete(campaign.id);
    }
  }

  // One round's log rows, its counts on the campaign, and the heartbeat.
  private async record(campaign: BulkNotificationCampaign, outcomes: Outcome[]) {
    const now = new Date();
    await this.prisma.notificationLog.createMany({
      data: outcomes.map((outcome) => ({
        platformUserId: outcome.userId,
        campaignId: campaign.id,
        templateKey: campaign.templateKey,
        channel: campaign.channel,
        status: outcome.status,
        sentAt: outcome.status === 'SENT' ? now : null,
        errorMessage: outcome.errorMessage,
      })),
    });
    const sent = outcomes.filter((outcome) => outcome.status === 'SENT').length;
    await this.prisma.bulkNotificationCampaign.update({
      where: { id: campaign.id },
      data: { sentCount: { increment: sent }, failedCount: { increment: outcomes.length - sent }, sentAt: now },
    });
  }

  // In-app: a bell row each, in the person's language, then a web push to
  // their devices in each device's language (best-effort; off without VAPID
  // keys). The key keeps it to one bell row per person per campaign.
  private async sendInApp(campaign: BulkNotificationCampaign, template: NotificationTemplate, people: Person[], appName: string): Promise<Outcome[]> {
    const wordsFor = (person: Person, language: 'EN' | 'BN') => {
      const { subject, body } = renderTemplate(template, language, recipientVariables({ ...person, planName: planNameOf(person) }, appName));
      return { title: subject ?? appName, body };
    };
    try {
      await this.prisma.userNotification.createMany({
        data: people.map((person) => ({
          userId: person.id,
          key: `campaign:${campaign.id}`,
          type: 'CAMPAIGN' as const,
          businessId: null,
          data: { event: 'CAMPAIGN', campaignId: campaign.id, ...wordsFor(person, person.preferredLanguage) },
        })),
        skipDuplicates: true,
      });
    } catch (error) {
      const errorMessage = errorText(error);
      return people.map((person) => ({ userId: person.id, status: 'FAILED', errorMessage }));
    }
    await this.push.send(
      people.map((person) => ({
        userId: person.id,
        build: (locale) => {
          const { title, body } = wordsFor(person, locale === 'bn' ? 'BN' : 'EN');
          return { title, body: body.length > PUSH_BODY_CHARS ? `${body.slice(0, PUSH_BODY_CHARS - 1)}…` : body, url: '/', tag: `campaign:${campaign.id}` };
        },
      })),
    );
    return people.map((person) => ({ userId: person.id, status: 'SENT', errorMessage: null }));
  }

  // Email: one Resend batch for the round; an address Resend refuses fails
  // alone, a failed request fails the round.
  private async sendEmails(campaign: BulkNotificationCampaign, template: NotificationTemplate, people: Person[], appName: string): Promise<Outcome[]> {
    const link = this.config.get<string>('USER_FRONTEND_URL') ?? 'http://localhost:3000';
    const emails = people.map((person) => {
      const { subject, body } = renderTemplate(template, person.preferredLanguage, recipientVariables({ ...person, planName: planNameOf(person) }, appName));
      return {
        to: person.email,
        locale: person.preferredLanguage === 'BN' ? ('bn' as const) : ('en' as const),
        email: { subject: subject ?? appName, body, link },
      };
    });
    // The same people in the same round give the same key, so a round
    // retried after a restart isn't delivered twice.
    const idempotencyKey = `campaign-${campaign.id}-${createHash('sha256')
      .update(people.map((person) => person.id).join(','))
      .digest('hex')
      .slice(0, 32)}`;
    try {
      const failed = await this.mail.sendCampaignBatch(emails, idempotencyKey);
      return people.map((person, i) => ({
        userId: person.id,
        status: failed.has(i) ? 'FAILED' : 'SENT',
        errorMessage: failed.has(i) ? (failed.get(i) ?? '').slice(0, MAX_ERROR_CHARS) : null,
      }));
    } catch (error) {
      const errorMessage = errorText(error);
      return people.map((person) => ({ userId: person.id, status: 'FAILED', errorMessage }));
    }
  }

  // From the admin who pressed "Send now", or, for a scheduled send, from
  // the admin who made the campaign (AuditLog needs an admin). A failed
  // audit write never undoes a send that happened.
  private async auditSent(
    campaign: BulkNotificationCampaign,
    by: { adminId: string; ipAddress?: string } | null,
    fromStatus: CampaignStatus,
    sentCount: number,
    failedCount: number,
  ) {
    try {
      await this.prisma.auditLog.create({
        data: {
          adminUserId: by?.adminId ?? campaign.createdBy,
          action: 'CAMPAIGN_SENT',
          entityType: 'BulkNotificationCampaign',
          entityId: campaign.id,
          oldValue: { status: fromStatus },
          newValue: { status: 'SENT', channel: campaign.channel, sentCount, failedCount, trigger: by ? 'SEND_NOW' : 'SCHEDULE' },
          ipAddress: by?.ipAddress,
        },
      });
    } catch (error) {
      this.logger.warn(`Could not audit the send of campaign ${campaign.id}: ${errorText(error)}`);
    }
  }

  private async requireCampaign(id: string) {
    const campaign = await this.prisma.bulkNotificationCampaign.findUnique({ where: { id } });
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }
    return campaign;
  }
}
