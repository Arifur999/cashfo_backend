import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Role } from '@prisma/client';
import { localeOf } from '../billing/billing-text.js';
import { toPaisa } from '../billing/pricing.js';
import { MailService } from '../mail/mail.service.js';
import { resolvePrefs } from '../notification-prefs/notification-prefs.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ReceivablesPayablesService } from '../receivables-payables/receivables-payables.service.js';
import { formattedFigures, hasActivity, summaryFigures } from './monthly-summary-rules.js';
import { summaryDueOn, summaryRange } from './period-summary-rules.js';

// People are read this many at a time, at most MAX_PEOPLE in one run
// (every few minutes), those already sent to today left out.
const BATCH = 500;
const MAX_PEOPLE = 20_000;
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
const UPCOMING_DAYS = 7;
const UPCOMING_ROWS = 4;

const MONTHS = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  bn: ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'],
};
const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
const digits = (text: string, locale: 'en' | 'bn') => (locale === 'bn' ? text.replace(/\d/g, (digit) => BN_DIGITS[Number(digit)]) : text);
// "7 November" / "৭ নভেম্বর"
const dayLabel = (date: Date, locale: 'en' | 'bn') => digits(`${date.getUTCDate()} ${MONTHS[locale][date.getUTCMonth()]}`, locale);

// Settings › Notifications › Daily or weekly summary: from the chosen time,
// a short email of money in and out over the day or the week for the
// person's own workspace, and what is due next. Each person is claimed
// first (periodSummarySentOn), so two servers or an overlapping tick never
// send twice; a failed send is logged and not retried.
@Injectable()
export class PeriodSummaryService {
  private readonly logger = new Logger(PeriodSummaryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly receivablesPayables: ReceivablesPayablesService,
  ) {}

  async run(now = new Date()): Promise<number> {
    if (!this.mail.configured) return 0;
    const today = new Date(now.getTime() + DHAKA_OFFSET_MS).toISOString().slice(0, 10);
    let sent = 0;
    let after: string | undefined;
    for (let read = 0; read < MAX_PEOPLE; read += BATCH) {
      const people = await this.prisma.user.findMany({
        where: {
          role: Role.USER,
          status: 'ACTIVE',
          ...(after && { id: { gt: after } }),
          AND: [
            { OR: [{ notificationPrefs: { equals: Prisma.DbNull } }, { NOT: { notificationPrefs: { path: ['summary', 'mode'], equals: 'off' } } }] },
            { OR: [{ periodSummarySentOn: null }, { periodSummarySentOn: { not: today } }] },
          ],
        },
        select: { id: true, name: true, email: true, preferredLanguage: true, notificationPrefs: true, periodSummarySentOn: true },
        orderBy: { id: 'asc' },
        take: BATCH,
      });
      if (people.length === 0) break;
      after = people[people.length - 1].id;
      sent += await this.sendTo(people, now);
    }
    return sent;
  }

  private async sendTo(people: { id: string; name: string; email: string; preferredLanguage: string; notificationPrefs: Prisma.JsonValue; periodSummarySentOn: string | null }[], now: Date): Promise<number> {
    let sent = 0;
    for (const person of people) {
      const prefs = resolvePrefs(person.notificationPrefs);
      const day = summaryDueOn(prefs, now, person.periodSummarySentOn);
      if (!day || prefs.summary.mode === 'off') continue;
      const { count } = await this.prisma.user.updateMany({ where: { id: person.id, OR: [{ periodSummarySentOn: null }, { periodSummarySentOn: { not: day } }] }, data: { periodSummarySentOn: day } });
      if (count !== 1) continue;
      try {
        if (await this.sendOne(person, prefs.summary.mode, day)) sent++;
      } catch (error) {
        this.logger.warn(`Summary for ${person.id} (${day}) failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return sent;
  }

  // False when there is nothing to tell (no workspace, a quiet stretch with
  // nothing coming up).
  private async sendOne(person: { id: string; name: string; email: string; preferredLanguage: string }, mode: 'daily' | 'weekly', day: string): Promise<boolean> {
    const workspace = await this.prisma.business.findFirst({ where: { ownerId: person.id, isDefault: true, deletedAt: null }, select: { id: true, name: true } });
    if (!workspace) return false;
    const { start, end } = summaryRange(mode, day);
    const entries = (transactionType: 'INCOME' | 'EXPENSE'): Prisma.TransactionEntryWhereInput => ({
      categoryId: { not: null },
      transaction: { businessId: workspace.id, status: 'POSTED', reversalOfId: null, transactionType, transactionDate: { gte: start, lt: end } },
    });
    const [income, expenses, saved, dues, events] = await Promise.all([
      this.prisma.transactionEntry.aggregate({ _sum: { amount: true }, where: entries('INCOME') }),
      this.prisma.transactionEntry.groupBy({ by: ['categoryId'], _sum: { amount: true }, where: entries('EXPENSE') }),
      this.prisma.savingsGoalEntry.aggregate({ _sum: { amount: true }, where: { businessId: workspace.id, type: 'CONTRIBUTION', date: { gte: start, lt: end } } }),
      this.receivablesPayables.dueWithin(workspace.id, UPCOMING_DAYS),
      this.prisma.socialEvent.findMany({ where: { businessId: workspace.id, date: { gte: end, lt: new Date(end.getTime() + UPCOMING_DAYS * 86_400_000) } }, orderBy: { date: 'asc' }, take: UPCOMING_ROWS, select: { title: true, date: true } }),
    ]);
    const figures = summaryFigures(
      toPaisa(income._sum.amount ?? 0),
      expenses.map((row) => ({ name: row.categoryId ?? '', paisa: toPaisa(row._sum.amount ?? 0) })),
      toPaisa(saved._sum.amount ?? 0),
    );
    const locale = localeOf(person.preferredLanguage);
    const money = (amount: string | number) => `${locale === 'bn' ? '৳' : 'TK'} ${digits(Number(amount).toLocaleString('en-IN', { maximumFractionDigits: 2 }), locale)}`;
    const upcoming = [
      ...dues.map((due) =>
        locale === 'bn'
          ? `${due.direction === 'PAYABLE' ? `${due.contactName}-কে দিতে হবে` : `${due.contactName} দেবেন`} ${money(due.remainingAmount)}, ${dayLabel(due.dueDate, locale)}`
          : `${due.direction === 'PAYABLE' ? `Pay ${due.contactName}` : `${due.contactName} pays you`} ${money(due.remainingAmount)} on ${dayLabel(due.dueDate, locale)}`,
      ),
      ...events.map((event) => (locale === 'bn' ? `${event.title}, ${dayLabel(event.date, locale)}` : `${event.title} on ${dayLabel(event.date, locale)}`)),
    ].slice(0, UPCOMING_ROWS);
    if (!hasActivity(figures) && upcoming.length === 0) return false;

    const frontend = this.config.get<string>('USER_FRONTEND_URL') ?? 'http://localhost:3000';
    const last = new Date(end.getTime() - 86_400_000);
    await this.mail.sendMonthlySummaryEmail(person.email, locale, {
      kind: mode === 'daily' ? 'day' : 'week',
      name: person.name,
      month: mode === 'daily' ? dayLabel(last, locale) : `${dayLabel(start, locale)} – ${dayLabel(last, locale)}`,
      workspaceName: locale === 'bn' && workspace.name === 'Personal' ? 'ব্যক্তিগত' : workspace.name,
      ...formattedFigures(figures, locale),
      upcoming,
      link: `${frontend}/reports/detailed`,
      settingsLink: `${frontend}/settings/notifications`,
    });
    return true;
  }
}
