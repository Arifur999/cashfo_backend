import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { dhakaDateKey } from '../common/dhaka.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ReceivablesPayablesService } from '../receivables-payables/receivables-payables.service.js';
import { NetWorthService, netOf } from './net-worth.service.js';

const dateOf = (day: string) => new Date(`${day}T00:00:00.000Z`);
const nextDay = (day: string) => new Date(dateOf(day).getTime() + 86_400_000);
const taka = (value: Prisma.Decimal | number | string | null | undefined) => Math.round(Number(value ?? 0) * 100) / 100;
const MAX_DAYS = 3 * 366;

// Where a period's money went (the dashboard's Cash flow card): income and
// expenses, what went into savings goals and came out, loans given, taken
// and paid back, assets bought and sold, and cash gifts given at events
// (kept apart from the expenses they are posted as). Also how much the net
// worth moved since last month ended (NetWorthService, as Reports has it).
@Injectable()
export class MoneyFlowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly receivablesPayables: ReceivablesPayablesService,
    private readonly netWorth: NetWorthService,
  ) {}

  async flow(businessId: string, from: string, to: string, now = new Date()) {
    if (to < from) throw new BadRequestException('dateTo must not be before dateFrom');
    if ((dateOf(to).getTime() - dateOf(from).getTime()) / 86_400_000 > MAX_DAYS) throw new BadRequestException('Pick at most three years');
    const start = dateOf(from);
    const end = nextDay(to);
    const [pnl, gifts, savings, loans, bought, sold, worthChange] = await Promise.all([
      this.profitAndLoss(businessId, start, end),
      this.giftsGiven(businessId, start, end),
      this.prisma.savingsGoalEntry.groupBy({ by: ['type'], where: { businessId, type: { in: ['CONTRIBUTION', 'WITHDRAWAL'] }, date: { gte: start, lt: end } }, _sum: { amount: true } }),
      this.receivablesPayables.loanFlow(businessId, from, to),
      this.prisma.asset.aggregate({ where: { businessId, purchaseTransactionId: { not: null }, purchaseDate: { gte: start, lt: end } }, _sum: { purchasePrice: true } }),
      this.prisma.asset.aggregate({ where: { businessId, soldTransactionId: { not: null }, soldAt: { gte: start, lt: end } }, _sum: { soldPrice: true } }),
      this.worthChangeThisMonth(businessId, now),
    ]);
    const income = pnl.get('INCOME') ?? { amount: 0, count: 0 };
    const expense = pnl.get('EXPENSE') ?? { amount: 0, count: 0 };
    return {
      dateFrom: from,
      dateTo: to,
      income,
      // Cash gifts at events are their own line.
      expenses: { amount: taka(expense.amount - gifts), count: expense.count },
      savings: { added: taka(savings.find((row) => row.type === 'CONTRIBUTION')?._sum.amount), takenOut: taka(savings.find((row) => row.type === 'WITHDRAWAL')?._sum.amount) },
      loans: { took: taka(loans.TOOK), gotBack: taka(loans.GOT_BACK), gave: taka(loans.GAVE), paidBack: taka(loans.PAID_BACK) },
      assets: { bought: taka(bought._sum.purchasePrice), sold: taka(sold._sum.soldPrice) },
      gifts: { gave: taka(gifts), got: 0 },
      worthChange,
    };
  }

  private async profitAndLoss(businessId: string, start: Date, end: Date) {
    const rows = await this.prisma.$queryRaw<{ type: string; count: number; amount: Prisma.Decimal | null }[]>`
      SELECT t."transactionType"::text AS "type", COUNT(DISTINCT t."id")::int AS "count", SUM(e."amount") FILTER (WHERE e."entryType" = 'DEBIT') AS "amount"
      FROM "Transaction" t JOIN "TransactionEntry" e ON e."transactionId" = t."id"
      WHERE t."businessId" = ${businessId} AND t."status" = 'POSTED' AND t."reversalOfId" IS NULL
        AND t."transactionType" IN ('INCOME', 'EXPENSE') AND t."transactionDate" >= ${start} AND t."transactionDate" < ${end}
      GROUP BY t."transactionType"`;
    return new Map(rows.map((row) => [row.type, { amount: taka(row.amount), count: row.count }]));
  }

  // Cash given at events that went into Transactions (a Gifts expense the
  // gift owns).
  private async giftsGiven(businessId: string, start: Date, end: Date): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ amount: Prisma.Decimal | null }[]>`
      SELECT SUM(e."amount") FILTER (WHERE e."entryType" = 'DEBIT') AS "amount"
      FROM "Transaction" t JOIN "TransactionEntry" e ON e."transactionId" = t."id"
      WHERE t."businessId" = ${businessId} AND t."status" = 'POSTED' AND t."reversalOfId" IS NULL
        AND t."transactionDate" >= ${start} AND t."transactionDate" < ${end}
        AND t."id" IN (SELECT g."transactionId" FROM "EventGift" g WHERE g."businessId" = ${businessId} AND g."transactionId" IS NOT NULL)`;
    return taka(rows[0]?.amount);
  }

  // Since the end of last month, from the records on both days.
  private async worthChangeThisMonth(businessId: string, now: Date): Promise<number> {
    const today = dhakaDateKey(now);
    const lastMonthEnd = new Date(dateOf(`${today.slice(0, 7)}-01`).getTime() - 86_400_000).toISOString().slice(0, 10);
    const [before, after] = await this.netWorth.on(businessId, [lastMonthEnd, today], today);
    return taka(netOf(after) - netOf(before));
  }
}
