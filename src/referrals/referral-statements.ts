import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { formatTaka, localeOf } from '../billing/billing-text.js';
import { toPaisa } from '../billing/pricing.js';
import { dhakaMonthStart } from '../common/dhaka.js';
import { HousekeepingScheduler } from '../housekeeping/housekeeping.scheduler.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { EARNED_STATUSES } from './referral-friends.js';
import { referralBalances } from './referral-ledger.js';

const HOUR = 60 * 60 * 1000;
const DHAKA_OFFSET_MS = 6 * HOUR;
// A statement goes on the 1st; the 2nd and 3rd catch up after a server
// that was down on the 1st.
const LAST_SEND_DAY = 3;
const BATCH = 200;

const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_BN = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];

// Which month's statement is due at `now` (Dhaka calendar): last month's,
// on the first days of a month; null on the other days.
export function statementDue(now: Date): { month: string; from: Date; until: Date; year: number; monthIndex: number } | null {
  const d = new Date(now.getTime() + DHAKA_OFFSET_MS);
  if (d.getUTCDate() > LAST_SEND_DAY) return null;
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const from = dhakaMonthStart(year, month - 1);
  const until = dhakaMonthStart(year, month);
  const last = new Date(from.getTime() + DHAKA_OFFSET_MS);
  return { month: last.toISOString().slice(0, 7), from, until, year: last.getUTCFullYear(), monthIndex: last.getUTCMonth() };
}

// Referrals > Profile & payouts > "Monthly statement": on the 1st, an email
// with last month's earnings to each member who asked for it and earned
// something that month. The month is claimed on the member's row before
// the email goes, so a second server or a restart never sends it twice.
@Injectable()
export class ReferralStatements implements OnModuleInit {
  private readonly logger = new Logger(ReferralStatements.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly housekeeping: HousekeepingScheduler,
  ) {}

  onModuleInit() {
    this.housekeeping.register({ name: 'referral-monthly-statements', everyMs: HOUR, run: async (now) => void (await this.sendDue(now)) });
  }

  // How many statements went out.
  async sendDue(now = new Date()): Promise<number> {
    if (!this.mail.configured) return 0;
    const due = statementDue(now);
    if (!due) return 0;
    const earnedIn = { status: { in: [...EARNED_STATUSES] }, OR: [{ payment: { paidAt: { gte: due.from, lt: due.until } } }, { paymentId: null, createdAt: { gte: due.from, lt: due.until } }] };
    const users = await this.prisma.user.findMany({
      where: {
        referralMonthlyStatement: true,
        status: 'ACTIVE',
        OR: [{ referralStatementSentFor: null }, { referralStatementSentFor: { not: due.month } }],
        referralCommissions: { some: earnedIn },
      },
      select: { id: true, name: true, email: true, preferredLanguage: true, referralStatementSentFor: true },
      take: BATCH,
    });
    let sent = 0;
    for (const user of users) {
      const { count } = await this.prisma.user.updateMany({
        where: { id: user.id, OR: [{ referralStatementSentFor: null }, { referralStatementSentFor: { not: due.month } }] },
        data: { referralStatementSentFor: due.month },
      });
      if (count === 0) continue;
      try {
        const [lines, balances] = await Promise.all([
          this.prisma.referralCommission.findMany({ where: { referrerId: user.id, ...earnedIn }, select: { amount: true } }),
          referralBalances(this.prisma, user.id),
        ]);
        const locale = localeOf(user.preferredLanguage);
        await this.mail.sendReferralStatementEmail(user.email, locale, {
          name: user.name,
          month: `${(locale === 'en' ? MONTHS_EN : MONTHS_BN)[due.monthIndex]} ${due.year}`,
          payments: lines.length,
          earned: formatTaka(lines.reduce((total, line) => total + toPaisa(line.amount), 0), locale),
          available: formatTaka(balances.availablePaisa, locale),
          link: `${this.config.get<string>('USER_FRONTEND_URL') ?? 'http://localhost:3000'}/referrals/earnings`,
        });
        sent++;
      } catch (error) {
        // Not sent: the month goes back, so the next tick tries again.
        await this.prisma.user.updateMany({ where: { id: user.id, referralStatementSentFor: due.month }, data: { referralStatementSentFor: user.referralStatementSentFor } }).catch(() => undefined);
        this.logger.warn(`Referral statement for user ${user.id} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return sent;
  }
}
