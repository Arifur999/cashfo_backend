import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Role } from '@prisma/client';
import { localeOf } from '../billing/billing-text.js';
import { toPaisa } from '../billing/pricing.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { categoryNamesBn } from '../user-notifications/reminders.js';
import {
  dueSummaryMonth,
  formattedFigures,
  hasActivity,
  monthBounds,
  monthEndInstant,
  monthLabel,
  summaryFigures,
  type SummaryFigures,
} from './monthly-summary-rules.js';

// At most this many summaries per run (the job runs hourly, so a big list
// takes a few hours of the first day).
const BATCH = 50;

// Settings > App > Reminders > "Monthly summary by email": on the first
// days of each month, last month's income, spending and savings for each
// opted-in customer's own (default) workspace. Each person is claimed
// first (monthlySummarySentFor), so two servers or an overlapping run never
// send twice; a failed send is logged and not retried.
@Injectable()
export class MonthlySummaryService {
  private readonly logger = new Logger(MonthlySummaryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
  ) {}

  async run(now = new Date()): Promise<{ month: string | null; sent: number }> {
    const month = dueSummaryMonth(now);
    // Without email nothing is claimed, so the month still goes out once
    // Resend is set up within the sending days.
    if (!month || !this.mail.configured) return { month, sent: 0 };

    const notSentYet: Prisma.UserWhereInput = { OR: [{ monthlySummarySentFor: null }, { monthlySummarySentFor: { not: month } }] };
    const people = await this.prisma.user.findMany({
      where: { role: Role.USER, status: 'ACTIVE', monthlySummaryEmail: true, createdAt: { lt: monthEndInstant(month) }, ...notSentYet },
      select: { id: true, name: true, email: true, preferredLanguage: true },
      orderBy: { id: 'asc' },
      take: BATCH,
    });
    let sent = 0;
    for (const person of people) {
      const { count } = await this.prisma.user.updateMany({
        where: { id: person.id, monthlySummaryEmail: true, ...notSentYet },
        data: { monthlySummarySentFor: month },
      });
      if (count !== 1) continue;
      try {
        if (await this.sendOne(person, month)) sent++;
      } catch (error) {
        this.logger.warn(`Monthly summary for ${person.id} (${month}) failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { month, sent };
  }

  // False when there is nothing to tell (no workspace, an empty month).
  private async sendOne(person: { id: string; name: string; email: string; preferredLanguage: string }, month: string): Promise<boolean> {
    const workspace = await this.prisma.business.findFirst({
      where: { ownerId: person.id, isDefault: true, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!workspace) return false;
    const figures = await this.figures(workspace.id, month);
    if (!hasActivity(figures)) return false;

    const locale = localeOf(person.preferredLanguage);
    const nameBn = locale === 'bn' ? await this.expenseNamesBn() : null;
    const frontend = this.config.get<string>('USER_FRONTEND_URL') ?? 'http://localhost:3000';
    await this.mail.sendMonthlySummaryEmail(person.email, locale, {
      name: person.name,
      month: monthLabel(month, locale),
      // The auto-created workspace is called "Personal"; Bangla readers get its Bangla name.
      workspaceName: locale === 'bn' && workspace.name === 'Personal' ? 'ব্যক্তিগত' : workspace.name,
      ...formattedFigures(figures, locale, nameBn ? (name) => nameBn(name) ?? name : undefined),
      link: `${frontend}/reports/overview`,
      settingsLink: `${frontend}/settings/app`,
    });
    return true;
  }

  // Totals count posted, unreversed transactions only, and one side of each
  // pair (the categorised entry), the same reading as the reports.
  private async figures(businessId: string, month: string): Promise<SummaryFigures> {
    const { start, end } = monthBounds(month);
    const entries = (transactionType: 'INCOME' | 'EXPENSE'): Prisma.TransactionEntryWhereInput => ({
      categoryId: { not: null },
      transaction: { businessId, status: 'POSTED', reversalOfId: null, transactionType, transactionDate: { gte: start, lt: end } },
    });
    const [income, expenses, saved] = await Promise.all([
      this.prisma.transactionEntry.aggregate({ _sum: { amount: true }, where: entries('INCOME') }),
      this.prisma.transactionEntry.groupBy({ by: ['categoryId'], _sum: { amount: true }, where: entries('EXPENSE') }),
      this.prisma.savingsGoalEntry.aggregate({ _sum: { amount: true }, where: { businessId, type: 'CONTRIBUTION', date: { gte: start, lt: end } } }),
    ]);
    return summaryFigures(
      toPaisa(income._sum.amount ?? 0),
      expenses.map((row) => ({ name: row.categoryId ?? '', paisa: toPaisa(row._sum.amount ?? 0) })),
      toPaisa(saved._sum.amount ?? 0),
    );
  }

  private async expenseNamesBn() {
    const defaults = await this.prisma.defaultCategory.findMany({
      where: { type: 'EXPENSE' },
      orderBy: [{ isActive: 'desc' }, { displayOrder: 'asc' }],
      select: { name: true, nameBn: true },
    });
    return categoryNamesBn(defaults);
  }
}
