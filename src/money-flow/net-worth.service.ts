import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MONEY_ACCOUNT_SUBTYPES } from '../accounts/accounts.service.js';
import { LIVE_TRANSACTION } from '../accounts/account-figures.js';
import { dhakaDateKey } from '../common/dhaka.js';
import { dayOf, figuresOf } from '../investments/investment-figures.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ReceivablesPayablesService } from '../receivables-payables/receivables-payables.service.js';

const dateOf = (day: string) => new Date(`${day}T00:00:00.000Z`);
const taka = (value: Prisma.Decimal | number | string | null | undefined) => Math.round(Number(value ?? 0) * 100) / 100;

export interface WorthOn {
  day: string;
  parts: { cash: number; savings: number; assets: number; investments: number; pawna: number; dena: number };
  counts: { accounts: number; assets: number; investments: number; pawna: number; dena: number };
}

export const netOf = (worth: WorthOn) =>
  taka(worth.parts.cash + worth.parts.savings + worth.parts.assets + worth.parts.investments + worth.parts.pawna - worth.parts.dena);

// The net worth when a day ended, from the records themselves: money and
// savings wallets' balances by then, the assets held (at their last value
// written by then), the capital still in investments, and what people owed
// you and you owed. Money put into an investment from a wallet left the
// wallet, so it counts once, as the investment's. The Dashboard's
// "since" and Reports' statement both come from here, so they agree.
@Injectable()
export class NetWorthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly receivablesPayables: ReceivablesPayablesService,
  ) {}

  async on(businessId: string, days: string[], today: string): Promise<WorthOn[]> {
    const [wallets, assets, investments, loans] = await Promise.all([
      Promise.all(days.map((day) => this.walletsAt(businessId, day))),
      this.assetsAt(businessId, days, today),
      this.investmentsAt(businessId, days),
      this.receivablesPayables.loanBalancesAt(businessId, days),
    ]);
    return days.map((day, index) => ({
      day,
      parts: {
        cash: wallets[index].cash,
        savings: wallets[index].savings,
        assets: assets[index].value,
        investments: investments[index].capital,
        pawna: taka(loans[index].pawna),
        dena: taka(loans[index].dena),
      },
      counts: { accounts: wallets[index].accounts, assets: assets[index].count, investments: investments[index].count, pawna: loans[index].owesYou, dena: loans[index].youOwe },
    }));
  }

  // Money in the wallets and in the savings wallets when a day ended: each
  // account's opening balance and every standing entry dated on or before it.
  private async walletsAt(businessId: string, day: string) {
    const accounts = await this.prisma.account.findMany({
      where: { businessId, accountType: 'ASSET', accountSubtype: { in: [...MONEY_ACCOUNT_SUBTYPES, 'savings'] } },
      select: { id: true, accountSubtype: true, openingBalance: true, status: true },
    });
    if (accounts.length === 0) return { cash: 0, savings: 0, accounts: 0 };
    const grouped = await this.prisma.transactionEntry.groupBy({
      by: ['accountId', 'entryType'],
      where: { accountId: { in: accounts.map((account) => account.id) }, transaction: { businessId, ...LIVE_TRANSACTION, transactionDate: { lte: dateOf(day) } } },
      _sum: { amount: true },
    });
    let cash = 0;
    let saved = 0;
    for (const account of accounts) {
      const net = grouped
        .filter((row) => row.accountId === account.id)
        .reduce((sum, row) => sum + (row.entryType === 'DEBIT' ? 1 : -1) * Number(row._sum.amount ?? 0), Number(account.openingBalance));
      if (account.accountSubtype === 'savings') saved += net;
      else cash += net;
    }
    return { cash: taka(cash), savings: taka(saved), accounts: accounts.filter((account) => account.accountSubtype !== 'savings' && account.status !== 'ARCHIVED').length };
  }


  // The capital still in investments when each day ended: what was put in
  // by then less what came back and was lost (Investments' own figures), for
  // each investment that still had some.
  private async investmentsAt(businessId: string, days: string[]) {
    const investments = await this.prisma.investment.findMany({ where: { businessId }, select: { entries: { select: { type: true, amount: true, date: true } } } });
    return days.map((day) => {
      let capital = 0;
      let count = 0;
      for (const investment of investments) {
        const left = figuresOf(investment.entries.map((entry) => ({ type: entry.type, amount: entry.amount, day: dayOf(entry.date) })), day).capital;
        if (!left.greaterThan(0)) continue;
        capital += Number(left);
        count += 1;
      }
      return { capital: taka(capital), count };
    });
  }

  // What was held, and worth, when each day ended: the last value written
  // by then, else the price paid; today, the value written now.
  private async assetsAt(businessId: string, days: string[], today: string) {
    const assets = await this.prisma.asset.findMany({
      where: { businessId },
      select: { purchaseDate: true, purchasePrice: true, currentValue: true, soldAt: true, status: true, valueHistory: { select: { value: true, recordedAt: true }, orderBy: { recordedAt: 'asc' } } },
    });
    return days.map((day) => {
      let value = 0;
      let count = 0;
      for (const asset of assets) {
        if (dhakaDateKey(asset.purchaseDate) > day) continue;
        if (asset.soldAt && dhakaDateKey(asset.soldAt) <= day) continue;
        const written = asset.valueHistory.filter((row) => dhakaDateKey(row.recordedAt) <= day).at(-1);
        value += day >= today && asset.status === 'ACTIVE' ? Number(asset.currentValue) : Number(written?.value ?? asset.purchasePrice);
        count += 1;
      }
      return { value: taka(value), count };
    });
  }
}
