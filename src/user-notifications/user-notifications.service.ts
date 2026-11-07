import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { alertOfRow, resolvePrefs } from '../notification-prefs/notification-prefs.js';
import { NotificationPrefsService } from '../notification-prefs/notification-prefs.service.js';
import { Prisma } from '@prisma/client';
import { AnnouncementsService } from '../announcements/announcements.service.js';
import { BudgetsService } from '../budgets/budgets.service.js';
import { WorkspaceUnlockService } from '../business-access/workspace-unlock.service.js';
import { dhakaDateKey, dhakaDateOnly, dhakaToday } from '../common/dhaka.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ReceivablesPayablesService } from '../receivables-payables/receivables-payables.service.js';
import { SavingsGoalsService } from '../savings-goals/savings-goals.service.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { UpdateReminderPreferencesDto } from './dto/update-reminder-preferences.dto.js';
import { announcementReminders, budgetReminders, categoryNamesBn, loanReminders, savingsReminders, zakatReminders, type ReminderDraft } from './reminders.js';

// The checks run when the feed is read, at most this often per user.
const CHECK_EVERY_MS = 30 * 60 * 1000;
// Loan payments are reminded about a day ahead (Settings > Reminders), and
// on the day itself if the feed wasn't read the day before.
const LOAN_DAYS = 1;
const FEED_SIZE = 30;
// Older rows are cleared when the checks run.
const KEEP_MS = 90 * 24 * 60 * 60 * 1000;

const FEED_SELECT = { id: true, businessId: true, type: true, data: true, readAt: true, createdAt: true } as const;

// The bell's feed in the customer app. There is no scheduler: reading the
// feed runs the reminder checks (budget, loan due dates, savings check-ins,
// announcements) when they are due, and each reminder's key keeps it to
// one row however often they run.
@Injectable()
export class UserNotificationsService {
  private readonly logger = new Logger(UserNotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly budgetsService: BudgetsService,
    private readonly receivablesPayablesService: ReceivablesPayablesService,
    private readonly savingsGoalsService: SavingsGoalsService,
    private readonly announcementsService: AnnouncementsService,
    private readonly mail: MailService,
    private readonly unlocks: WorkspaceUnlockService,
    private readonly prefs: NotificationPrefsService,
  ) {}

  // A reminder about a PIN-locked workspace keeps its details (a contact's
  // name, an amount, a goal) out of the bell unless the request carries that
  // workspace's unlock: only that it is there, and which workspace, show.
  async feed(user: RequestUser, unlockTokens: string[] = []) {
    const userId = user.id;
    await this.refresh(userId);
    const [all, prefs] = await Promise.all([
      this.prisma.userNotification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: FEED_SIZE, select: FEED_SELECT }),
      this.prefs.get(userId),
    ]);
    // Rows of an alert turned off in the bell are left out, and read, so
    // the count says what the bell shows.
    const hidden = all.filter((row) => {
      const alert = alertOfRow(row.type, row.data as Record<string, unknown> | null);
      return alert !== null && !prefs.alerts[alert]?.app;
    });
    if (hidden.some((row) => !row.readAt)) await this.prisma.userNotification.updateMany({ where: { id: { in: hidden.filter((row) => !row.readAt).map((row) => row.id) } }, data: { readAt: new Date() } });
    const unreadCount = await this.prisma.userNotification.count({ where: { userId, readAt: null } });
    const rows = all.filter((row) => !hidden.includes(row));
    const businessIds = [...new Set(rows.flatMap((row) => (row.businessId ? [row.businessId] : [])))];
    const workspaces = businessIds.length ? await this.prisma.business.findMany({ where: { id: { in: businessIds }, pinHash: { not: null } }, select: { id: true, pinHash: true } }) : [];
    const shut = new Set(workspaces.filter((workspace) => this.unlocks.isShut(user, workspace, unlockTokens)).map((workspace) => workspace.id));
    const data = rows.map((row) => (row.businessId && shut.has(row.businessId) ? { ...row, data: {}, locked: true } : row));
    return { data, unreadCount };
  }

  async markRead(userId: string, id: string) {
    const row = await this.prisma.userNotification.findFirst({ where: { id, userId }, select: { id: true, readAt: true } });
    if (!row) throw new NotFoundException('Notification not found');
    if (!row.readAt) await this.prisma.userNotification.update({ where: { id }, data: { readAt: new Date() } });
    return { success: true };
  }

  async markAllRead(userId: string) {
    const { count } = await this.prisma.userNotification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
    return { count };
  }

  // monthlySummaryEmail: last month's summary by email on the 1st
  // (src/monthly-summary); emailReady: whether email is set up yet, until
  // when the app keeps that switch marked "Coming soon".
  async preferences(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { remindBudget: true, remindLoans: true, remindSavings: true, monthlySummaryEmail: true },
    });
    return {
      budget: user.remindBudget,
      loans: user.remindLoans,
      savings: user.remindSavings,
      monthlySummaryEmail: user.monthlySummaryEmail,
      emailReady: this.mail.configured,
    };
  }

  // A reminder switched on is checked the next time the feed is read.
  async setPreferences(userId: string, dto: UpdateReminderPreferencesDto) {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        remindBudget: dto.budget,
        remindLoans: dto.loans,
        remindSavings: dto.savings,
        monthlySummaryEmail: dto.monthlySummaryEmail,
        remindersCheckedAt: null,
      },
    });
    return this.preferences(userId);
  }

  // Runs the checks if the last run is older than CHECK_EVERY_MS. The run is
  // claimed first, so two tabs opening at once don't both check; a failed
  // check never costs the customer their feed and is tried again later.
  private async refresh(userId: string) {
    const now = new Date();
    const claimed = await this.prisma.user.updateMany({
      where: { id: userId, OR: [{ remindersCheckedAt: null }, { remindersCheckedAt: { lt: new Date(now.getTime() - CHECK_EVERY_MS) } }] },
      data: { remindersCheckedAt: now },
    });
    if (claimed.count === 0) return;
    try {
      const drafts = await this.collect(userId, now);
      if (drafts.length > 0) {
        await this.prisma.userNotification.createMany({
          data: drafts.map((draft) => ({ userId, key: draft.key, type: draft.type, businessId: draft.businessId, data: draft.data as Prisma.InputJsonObject, ...(draft.at && { createdAt: draft.at }) })),
          skipDuplicates: true,
        });
      }
      await this.prisma.userNotification.deleteMany({ where: { userId, createdAt: { lt: new Date(now.getTime() - KEEP_MS) } } });
    } catch (error) {
      this.logger.warn(`Reminder checks failed for user ${userId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Every reminder due now across the customer's own workspaces (not group
  // ones: they have no budget, loans or savings), as the switches allow.
  private async collect(userId: string, now: Date): Promise<ReminderDraft[]> {
    const [user, workspaces] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { remindBudget: true, remindLoans: true, remindSavings: true, notificationPrefs: true } }),
      this.prisma.business.findMany({ where: { ownerId: userId, deletedAt: null }, select: { id: true, type: true, planId: true } }),
    ]);
    const today = dhakaToday();
    const month = `${today.year}-${String(today.month).padStart(2, '0')}`;
    const drafts: ReminderDraft[] = [];
    const ownWorkspaces = workspaces.filter((w) => w.type !== 'GROUP');
    const nameBnOf: (name: string) => string | null = user.remindBudget && ownWorkspaces.length > 0 ? await this.expenseCategoryNamesBn() : () => null;

    for (const workspace of ownWorkspaces) {
      if (user.remindBudget) {
        const overview = await this.budgetsService.getOverview(workspace.id, {});
        const lines = overview.categories.map((category) => ({ ...category, nameBn: nameBnOf(category.name) }));
        drafts.push(...budgetReminders(workspace.id, month, lines));
      }
      if (user.remindLoans) {
        drafts.push(...loanReminders(workspace.id, await this.receivablesPayablesService.dueWithin(workspace.id, resolvePrefs(user.notificationPrefs).loanDaysBefore || LOAN_DAYS)));
      }
      if (user.remindSavings) {
        const goals = await this.savingsGoalsService.list(workspace.id, 'ACTIVE');
        drafts.push(...savingsReminders(workspace.id, month, dhakaDateOnly(now), goals));
      }
    }

    // The zakat date coming, where zakat was worked out and some is left.
    const zakat = await this.prisma.zakatProfile.findMany({
      where: { businessId: { in: ownWorkspaces.map((w) => w.id) }, lastZakat: { gt: 0 }, lastDueDate: { not: null } },
      select: { businessId: true, lastZakat: true, lastDueDate: true },
    });
    if (zakat.length > 0) {
      const paid = await this.prisma.zakatPayment.groupBy({
        by: ['businessId', 'dueDate'],
        where: { businessId: { in: zakat.map((z) => z.businessId) } },
        _sum: { amount: true },
      });
      const paidOf = (businessId: string, dueDate: string) => Number(paid.find((p) => p.businessId === businessId && p.dueDate === dueDate)?._sum.amount ?? 0);
      drafts.push(
        ...zakatReminders(
          dhakaDateKey(now),
          zakat.map((z) => ({ businessId: z.businessId, dueDate: z.lastDueDate!, zakat: Number(z.lastZakat), paid: paidOf(z.businessId, z.lastDueDate!) })),
        ),
      );
    }

    // Announcements for everyone, or for a plan one of their workspaces is on.
    const planIds = [...new Set(workspaces.flatMap((w) => (w.planId ? [w.planId] : [])))];
    drafts.push(...announcementReminders(await this.announcementsService.forCustomer(planIds)));
    return drafts;
  }

  // The Bangla names a budget reminder can give its category: the default
  // expense categories', an active one's first (see categoryNamesBn()).
  private async expenseCategoryNamesBn() {
    const defaults = await this.prisma.defaultCategory.findMany({
      where: { type: 'EXPENSE' },
      orderBy: [{ isActive: 'desc' }, { displayOrder: 'asc' }],
      select: { name: true, nameBn: true },
    });
    return categoryNamesBn(defaults);
  }
}
