import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type SavingsGoal } from '@prisma/client';
import { dateLabel, formatTaka, localeOf } from '../billing/billing-text.js';
import { dhakaDateKey } from '../common/dhaka.js';
import { HousekeepingScheduler } from '../housekeeping/housekeeping.scheduler.js';
import { MailService } from '../mail/mail.service.js';
import { renderSavingsReminderEmail } from '../mail/templates/savings-reminder-email.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { dateReminderDue, monthlyReminderMonth, perMonthFromNow, REMINDER_GRACE_DAYS } from './savings-reminders.js';
import { entrySign } from './savings-holdings.js';

const HALF_HOUR = 30 * 60 * 1000;
// At most this many emails a run.
const BATCH = 50;

const dayOf = (date: Date) => date.toISOString().slice(0, 10);

// Savings goal reminder emails, to the workspace owner's profile email:
// the day set on the goal, and Catch up's monthly reminder on the 1st.
// Each one is claimed first (reminderSentFor / monthlyReminderSentFor), so
// two servers or an overlapping run never send it twice; a failed send is
// logged and not retried. Without email set up nothing is claimed.
@Injectable()
export class SavingsRemindersService implements OnModuleInit {
  private readonly logger = new Logger(SavingsRemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly housekeeping: HousekeepingScheduler,
  ) {}

  onModuleInit() {
    this.housekeeping.register({ name: 'savings-reminders', everyMs: HALF_HOUR, run: async (now) => void (await this.run(now)) });
  }

  async run(now = new Date()): Promise<number> {
    if (!this.mail.configured) return 0;
    const today = dhakaDateKey(now);
    const earliest = new Date(`${today}T00:00:00.000Z`);
    earliest.setUTCDate(earliest.getUTCDate() - REMINDER_GRACE_DAYS);
    let sent = 0;

    const dated = await this.prisma.savingsGoal.findMany({
      where: { status: { in: ['ACTIVE', 'PAUSED'] }, reminderDate: { gte: earliest, lte: new Date(`${today}T23:59:59.999Z`) } },
      take: BATCH,
    });
    for (const goal of dated) {
      const day = goal.reminderDate ? dayOf(goal.reminderDate) : null;
      if (!dateReminderDue(day, goal.reminderSentFor ? dayOf(goal.reminderSentFor) : null, today)) continue;
      const { count } = await this.prisma.savingsGoal.updateMany({
        where: { id: goal.id, reminderDate: goal.reminderDate, OR: [{ reminderSentFor: null }, { reminderSentFor: { not: goal.reminderDate as Date } }] },
        data: { reminderSentFor: goal.reminderDate },
      });
      if (count === 1 && (await this.send(goal, 'DATE', today))) sent++;
    }

    const month = monthlyReminderMonth(today, null);
    if (month) {
      const monthly = await this.prisma.savingsGoal.findMany({
        where: { status: 'ACTIVE', monthlyReminder: true, OR: [{ monthlyReminderSentFor: null }, { monthlyReminderSentFor: { not: month } }] },
        take: BATCH,
      });
      for (const goal of monthly) {
        const { count } = await this.prisma.savingsGoal.updateMany({
          where: { id: goal.id, monthlyReminder: true, OR: [{ monthlyReminderSentFor: null }, { monthlyReminderSentFor: { not: month } }] },
          data: { monthlyReminderSentFor: month },
        });
        if (count === 1 && (await this.send(goal, 'MONTHLY', today))) sent++;
      }
    }
    return sent;
  }

  private async send(goal: SavingsGoal, kind: 'DATE' | 'MONTHLY', today: string): Promise<boolean> {
    try {
      const business = await this.prisma.business.findUnique({
        where: { id: goal.businessId },
        select: { deletedAt: true, owner: { select: { name: true, email: true, preferredLanguage: true, status: true } } },
      });
      const owner = business?.owner;
      if (!owner || business.deletedAt || owner.status !== 'ACTIVE') return false;
      const saved = await this.saved(goal.id);
      const target = new Prisma.Decimal(goal.targetAmount);
      const locale = localeOf(owner.preferredLanguage);
      const paisa = (value: Prisma.Decimal.Value) => Math.round(new Prisma.Decimal(value).times(100).toNumber());
      const perMonth = goal.status === 'ACTIVE' && saved.lessThan(target) ? perMonthFromNow(target.toNumber(), saved.toNumber(), dayOf(goal.targetDate), today) : null;
      const frontend = this.config.get<string>('USER_FRONTEND_URL') ?? 'http://localhost:3000';
      const email = renderSavingsReminderEmail(
        locale,
        {
          name: owner.name,
          goalName: goal.name,
          kind,
          saved: formatTaka(paisa(saved), locale),
          target: formatTaka(paisa(target), locale),
          perMonth: perMonth === null ? null : formatTaka(perMonth * 100, locale),
          endDate: dateLabel(goal.targetDate, locale),
          link: `${frontend.replace(/\/$/, '')}/savings-goals/dashboard`,
        },
        await this.mail.platformName(),
      );
      await this.mail.sendEmail({ to: owner.email, ...email });
      return true;
    } catch (error) {
      this.logger.warn(`Savings reminder for goal ${goal.id} failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  private async saved(goalId: string): Promise<Prisma.Decimal> {
    const grouped = await this.prisma.savingsGoalEntry.groupBy({ by: ['type'], where: { savingsGoalId: goalId }, _sum: { amount: true } });
    return grouped.reduce((total, row) => {
      const amount = new Prisma.Decimal(row._sum.amount ?? 0);
      return total.plus(amount.times(entrySign(row.type)));
    }, new Prisma.Decimal(0));
  }
}
