import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type ZakatGroup, type ZakatMetal, type ZakatProfile } from '@prisma/client';
import { MONEY_ACCOUNT_SUBTYPES } from '../accounts/accounts.service.js';
import { fromPaisa, toPaisa } from '../billing/pricing.js';
import { nextCategoryColor } from '../budgets/budgets.service.js';
import { dhakaDateKey } from '../common/dhaka.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ReceivablesPayablesService } from '../receivables-payables/receivables-payables.service.js';
import { TransactionsService } from '../transactions/transactions.service.js';
import type {
  CreateZakatExtraDto,
  RecordZakatDto,
  UpdateZakatSettingsDto,
  ZakatAssetWeightDto,
  ZakatCheckDto,
  ZakatLineDto,
  ZakatStep,
} from './dto/zakat.dto.js';
import { ZakatPricesService } from './zakat-prices.service.js';
import {
  assetZakatOf,
  daysBetween,
  debtWithinYearPaisa,
  dueDateFor,
  metalValuePaisa,
  monthlyParts,
  nisabPaisa,
  pricesPerVori,
  zakatPaisa,
} from './zakat-rules.js';
import { ZAKAT_CATEGORY } from '../budgets/app-categories.js';

type Client = PrismaService | Prisma.TransactionClient;

// The expense category zakat given goes under, made the first time (kept
// with the app's other category names).
export { ZAKAT_CATEGORY };
const MAX_EXTRAS = 100;
const MAX_KEYS = 500;

// One line of a step, as the page shows it. Money is a 2-decimal string.
export interface ZakatLine {
  key: string;
  source: 'ACCOUNT' | 'CONTACT' | 'ASSET' | 'EXTRA';
  id: string;
  name: string;
  // An account's subtype ("cash", "bank", "mfs", "savings") or number; an
  // asset's category; a contact's category.
  detail: string | null;
  amount: string;
  counted: boolean;
  // Gold and silver: the metal and weight, and whether today's price
  // valued it (else the value written in Assets).
  metal?: ZakatMetal | null;
  weightVori?: string | null;
  byWeight?: boolean;
  // A debt: the whole of it, what falls due within 12 months, and which is taken off.
  fullAmount?: string;
  yearAmount?: string;
  debtMode?: 'YEAR' | 'FULL';
  // Land, a flat or a car: bought to sell, so counted under investments.
  forSale?: boolean;
}

export interface ZakatStepView {
  step: ZakatStep | 'NOT_COUNTED';
  total: string;
  checked: boolean;
  lines: ZakatLine[];
}

const money = (paisa: number) => fromPaisa(paisa);

// Zakat calculator: the year's zakat worked out from the workspace's own
// records on every read, the member's choices, things they added by hand,
// and the zakat they recorded giving (each an expense under Zakat).
@Injectable()
export class ZakatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly prices: ZakatPricesService,
    private readonly loans: ReceivablesPayablesService,
    private readonly transactions: TransactionsService,
  ) {}

  async summary(businessId: string) {
    const today = dhakaDateKey(new Date());
    const [profile, platform] = await Promise.all([this.profile(businessId), this.prices.get()]);
    const gold22 = profile.goldPrice ? toPaisa(profile.goldPrice) / 100 : platform.gold22;
    const silver22 = profile.silverPrice ? toPaisa(profile.silverPrice) / 100 : platform.silver22;
    const perVori = pricesPerVori(gold22, silver22);
    const due = dueDateFor(profile.dateMode, profile.customDate, today);
    const excluded = new Set(profile.excluded);
    const debtFull = new Set(profile.debtFull);
    const forSale = new Set(profile.forSale);

    const [accounts, assets, contacts, extras, payments] = await Promise.all([
      this.prisma.account.findMany({
        where: { businessId, status: 'ACTIVE', accountType: 'ASSET', accountSubtype: { in: [...MONEY_ACCOUNT_SUBTYPES, 'savings'] } },
        orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, name: true, accountSubtype: true, accountNumber: true, currentBalance: true, isSystemAccount: true },
      }),
      this.prisma.asset.findMany({ where: { businessId, status: 'ACTIVE' }, orderBy: { purchaseDate: 'asc' } }),
      this.prisma.contact.findMany({ where: { businessId, status: 'ACTIVE' }, select: { id: true, name: true, category: true, openingBalance: true } }),
      this.prisma.zakatExtra.findMany({ where: { businessId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.zakatPayment.findMany({ where: { businessId, dueDate: due.date }, orderBy: [{ paidOn: 'desc' }, { createdAt: 'desc' }] }),
    ]);

    const steps = new Map<ZakatStepView['step'], ZakatLine[]>([
      ['CASH', []],
      ['SAVINGS', []],
      ['GOLD', []],
      ['INVESTMENTS', []],
      ['OWED_TO_YOU', []],
      ['YOU_OWE', []],
      ['NOT_COUNTED', []],
    ]);
    const push = (step: ZakatStepView['step'], line: ZakatLine) => steps.get(step)!.push(line);

    // Wallets and savings accounts, at their balance today.
    for (const account of accounts) {
      const paisa = toPaisa(account.currentBalance);
      // The hidden pooled savings account only when it holds something.
      if (account.isSystemAccount && paisa === 0) continue;
      const key = `account:${account.id}`;
      push(account.accountSubtype === 'savings' ? 'SAVINGS' : 'CASH', {
        key,
        source: 'ACCOUNT',
        id: account.id,
        name: account.name,
        detail: account.accountNumber ? `•••• ${account.accountNumber.replace(/\s/g, '').slice(-4)}` : account.accountSubtype,
        amount: money(paisa),
        counted: !excluded.has(key),
      });
    }

    // Assets: gold and silver by weight at today's price (or the value in
    // Assets), investments at their value, the rest not counted unless
    // bought to sell.
    for (const asset of assets) {
      const key = `asset:${asset.id}`;
      const valuePaisa = toPaisa(asset.currentValue);
      const kind = assetZakatOf(asset.category);
      if (kind === 'GOLD') {
        const weight = asset.weightVori ? Number(asset.weightVori) : null;
        const byWeight = Boolean(asset.metal && weight);
        push('GOLD', {
          key,
          source: 'ASSET',
          id: asset.id,
          name: asset.name,
          detail: asset.category,
          amount: money(byWeight ? metalValuePaisa(weight!, perVori[asset.metal!]) : valuePaisa),
          counted: !excluded.has(key),
          metal: asset.metal,
          weightVori: weight === null ? null : String(weight),
          byWeight,
        });
      } else if (kind === 'INVESTMENTS' || forSale.has(asset.id)) {
        push('INVESTMENTS', {
          key,
          source: 'ASSET',
          id: asset.id,
          name: asset.name,
          detail: asset.category,
          amount: money(valuePaisa),
          counted: !excluded.has(key),
          ...(kind !== 'INVESTMENTS' && { forSale: true }),
        });
      } else {
        push('NOT_COUNTED', {
          key,
          source: 'ASSET',
          id: asset.id,
          name: asset.name,
          detail: asset.category,
          amount: money(valuePaisa),
          counted: false,
          forSale: false,
        });
      }
    }

    // What contacts owe (pawna) and what is owed to them (dena).
    const balances = contacts.length ? await this.loans.getContactCurrentBalances(businessId, contacts) : new Map<string, Prisma.Decimal>();
    const debtors = contacts.filter((contact) => toPaisa(balances.get(contact.id) ?? 0) < 0);
    const payables = debtors.length ? await this.loans.computeDirections(businessId, debtors, 'PAYABLE') : new Map();
    for (const contact of contacts) {
      const balance = toPaisa(balances.get(contact.id) ?? 0);
      if (balance === 0) continue;
      const key = `contact:${contact.id}`;
      if (balance > 0) {
        push('OWED_TO_YOU', {
          key,
          source: 'CONTACT',
          id: contact.id,
          name: contact.name,
          detail: contact.category,
          amount: money(balance),
          counted: !excluded.has(key),
        });
        continue;
      }
      const full = -balance;
      const breakdown = payables.get(contact.id);
      const withinYear = breakdown
        ? Math.min(
            full,
            debtWithinYearPaisa(
              toPaisa(breakdown.openingRemaining),
              breakdown.transactions.map((t: { remainingAmount: string; dueDate: Date | null }) => ({
                remainingPaisa: toPaisa(t.remainingAmount),
                dueDate: t.dueDate ? dhakaDateKey(t.dueDate) : null,
              })),
              today,
            ),
          )
        : full;
      const mode = debtFull.has(contact.id) || withinYear === full ? 'FULL' : 'YEAR';
      push('YOU_OWE', {
        key,
        source: 'CONTACT',
        id: contact.id,
        name: contact.name,
        detail: contact.category,
        amount: money(mode === 'FULL' ? full : withinYear),
        counted: !excluded.has(key),
        fullAmount: money(full),
        yearAmount: money(withinYear),
        debtMode: mode,
      });
    }

    // What the member added by hand.
    for (const extra of extras) {
      const weight = extra.weightVori ? Number(extra.weightVori) : null;
      const paisa = extra.metal && weight ? metalValuePaisa(weight, perVori[extra.metal]) : toPaisa(extra.amount ?? 0);
      push(extra.group, {
        key: `extra:${extra.id}`,
        source: 'EXTRA',
        id: extra.id,
        name: extra.name,
        detail: null,
        amount: money(paisa),
        counted: true,
        ...(extra.metal && { metal: extra.metal, weightVori: weight === null ? null : String(weight), byWeight: true }),
      });
    }

    const totalOf = (step: ZakatStepView['step']) =>
      steps
        .get(step)!
        .filter((line) => line.counted)
        .reduce((sum, line) => sum + toPaisa(line.amount), 0);
    const have = totalOf('CASH') + totalOf('SAVINGS') + totalOf('GOLD') + totalOf('INVESTMENTS');
    const owed = totalOf('OWED_TO_YOU');
    const owe = totalOf('YOU_OWE');
    const paid = payments.reduce((sum, payment) => sum + toPaisa(payment.amount), 0);
    // Zakat given this year left a counted wallet, so it is counted back:
    // giving it must not shrink the zakat it was part of.
    const countedWallets = new Set([...steps.get('CASH')!, ...steps.get('SAVINGS')!].filter((line) => line.counted).map((line) => line.id));
    const givenBack = payments.filter((payment) => countedWallets.has(payment.accountId)).reduce((sum, payment) => sum + toPaisa(payment.amount), 0);
    const net = have + givenBack + owed - owe;
    const nisab = nisabPaisa(profile.basis, gold22, silver22);
    const zakat = zakatPaisa(net, nisab);
    const left = Math.max(0, zakat - paid);
    const daysLeft = Math.max(0, daysBetween(today, due.date));
    const parts = monthlyParts(left, daysLeft);
    const checkedSteps = this.checkedFor(profile, due.date);

    // Kept for the bell's reminders before the due date.
    if (profile.lastDueDate !== due.date || toPaisa(profile.lastZakat ?? 0) !== zakat) {
      await this.prisma.zakatProfile.update({ where: { businessId }, data: { lastZakat: new Prisma.Decimal(money(zakat)), lastDueDate: due.date } });
    }

    return {
      today,
      dueDate: due.date,
      hijriYear: due.hijriYear,
      daysLeft,
      // What each Hijri choice in the settings comes to, for its label.
      dateChoices: { RAMADAN: dueDateFor('RAMADAN', null, today), MUHARRAM: dueDateFor('MUHARRAM', null, today) },
      settings: {
        basis: profile.basis,
        dateMode: profile.dateMode,
        customDate: profile.customDate,
        goldPrice: profile.goldPrice ? money(toPaisa(profile.goldPrice)) : null,
        silverPrice: profile.silverPrice ? money(toPaisa(profile.silverPrice)) : null,
      },
      prices: {
        gold22,
        silver22,
        perVori,
        own: Boolean(profile.goldPrice || profile.silverPrice),
        platform: { gold22: platform.gold22, silver22: platform.silver22, on: platform.on },
      },
      nisab: money(nisab),
      aboveNisab: zakat > 0,
      steps: [...steps].map(([step, lines]): ZakatStepView => ({
        step,
        total: money(step === 'NOT_COUNTED' ? 0 : totalOf(step)),
        checked: step !== 'NOT_COUNTED' && checkedSteps.includes(step),
        lines,
      })),
      totals: {
        have: money(have),
        givenBack: money(givenBack),
        owed: money(owed),
        owe: money(owe),
        net: money(net),
        zakat: money(zakat),
        paid: money(paid),
        left: money(left),
        parts: parts.parts,
        perPart: money(parts.perPart),
      },
      payments: payments.map((payment) => ({
        id: payment.id,
        amount: money(toPaisa(payment.amount)),
        paidOn: payment.paidOn.toISOString().slice(0, 10),
        accountId: payment.accountId,
        givenTo: payment.givenTo,
        transactionId: payment.transactionId,
      })),
    };
  }

  async updateSettings(businessId: string, dto: UpdateZakatSettingsDto) {
    if (dto.dateMode === 'CUSTOM' && !dto.customDate) {
      const current = await this.profile(businessId);
      if (!current.customDate) throw new BadRequestException('Pick your own date');
    }
    await this.profile(businessId);
    await this.prisma.zakatProfile.update({
      where: { businessId },
      data: {
        ...(dto.basis && { basis: dto.basis }),
        ...(dto.dateMode && { dateMode: dto.dateMode }),
        ...(dto.customDate && { customDate: dto.customDate }),
        ...(dto.goldPrice !== undefined && { goldPrice: dto.goldPrice === null ? null : new Prisma.Decimal(dto.goldPrice) }),
        ...(dto.silverPrice !== undefined && { silverPrice: dto.silverPrice === null ? null : new Prisma.Decimal(dto.silverPrice) }),
      },
    });
    return this.summary(businessId);
  }

  // A line counted or left out.
  async setLine(businessId: string, dto: ZakatLineDto) {
    await this.editList(businessId, 'excluded', dto.key, !dto.counted);
    return this.summary(businessId);
  }

  async setDebtMode(businessId: string, contactId: string, mode: 'YEAR' | 'FULL') {
    await this.requireOwn(this.prisma.contact, businessId, contactId, 'Contact');
    await this.editList(businessId, 'debtFull', contactId, mode === 'FULL');
    return this.summary(businessId);
  }

  async setForSale(businessId: string, assetId: string, forSale: boolean) {
    await this.requireOwn(this.prisma.asset, businessId, assetId, 'Asset');
    await this.editList(businessId, 'forSale', assetId, forSale);
    return this.summary(businessId);
  }

  // "Yes, this is right" counts for this zakat year only.
  async setChecked(businessId: string, dto: ZakatCheckDto) {
    const profile = await this.profile(businessId);
    const due = dueDateFor(profile.dateMode, profile.customDate, dhakaDateKey(new Date())).date;
    const steps = new Set(this.checkedFor(profile, due));
    if (dto.checked) steps.add(dto.step);
    else steps.delete(dto.step);
    await this.prisma.zakatProfile.update({ where: { businessId }, data: { checked: { dueDate: due, steps: [...steps] } } });
    return this.summary(businessId);
  }

  // Adding to a step means it is checked again.
  async addExtra(businessId: string, dto: CreateZakatExtraDto) {
    const count = await this.prisma.zakatExtra.count({ where: { businessId } });
    if (count >= MAX_EXTRAS) throw new ConflictException(`You can add up to ${MAX_EXTRAS} things. Remove one you no longer have.`);
    const metal = dto.group === 'GOLD';
    await this.prisma.zakatExtra.create({
      data: {
        businessId,
        group: dto.group,
        name: dto.name,
        amount: metal ? null : new Prisma.Decimal(dto.amount!),
        metal: metal ? dto.metal : null,
        weightVori: metal ? new Prisma.Decimal(dto.weightVori!) : null,
      },
    });
    await this.uncheck(businessId, dto.group);
    return this.summary(businessId);
  }

  async removeExtra(businessId: string, id: string) {
    const extra = await this.prisma.zakatExtra.findFirst({ where: { id, businessId }, select: { group: true } });
    if (!extra) throw new NotFoundException('Not found');
    await this.prisma.zakatExtra.delete({ where: { id } });
    await this.uncheck(businessId, extra.group);
    return this.summary(businessId);
  }

  // A gold or silver asset's metal and weight, kept on the asset itself.
  async setAssetWeight(businessId: string, assetId: string, dto: ZakatAssetWeightDto) {
    await this.requireOwn(this.prisma.asset, businessId, assetId, 'Asset');
    if ((dto.metal === null) !== (dto.weightVori === null)) throw new BadRequestException('Give both the metal and the weight, or neither');
    await this.prisma.asset.update({
      where: { id: assetId },
      data: { metal: dto.metal, weightVori: dto.weightVori === null ? null : new Prisma.Decimal(dto.weightVori) },
    });
    return this.summary(businessId);
  }

  // Zakat given: an expense under Zakat from one wallet and its record,
  // together, for the zakat year due now.
  async recordPayment(businessId: string, dto: RecordZakatDto, userId: string) {
    const today = dhakaDateKey(new Date());
    if (dto.paidOn > today) throw new BadRequestException('The date cannot be in the future');
    const profile = await this.profile(businessId);
    const due = dueDateFor(profile.dateMode, profile.customDate, today).date;
    // A zakat year is at most a solar year; earlier giving was an earlier year's.
    if (daysBetween(dto.paidOn, due) > 366) throw new BadRequestException('That date belongs to an earlier zakat year');
    const amountPaisa = Math.round(dto.amount * 100);

    await this.prisma.$transaction(async (tx) => {
      const account = await tx.account.findFirst({
        where: { id: dto.accountId, businessId, status: 'ACTIVE', accountType: 'ASSET', accountSubtype: { in: MONEY_ACCOUNT_SUBTYPES } },
      });
      if (!account) throw new BadRequestException('Pick a cash, bank or mobile banking wallet');
      // Row-locked, so two payments from one wallet can't both pass.
      await tx.$executeRaw`SELECT id FROM "Account" WHERE id = ${account.id} FOR UPDATE`;
      const fresh = await tx.account.findUniqueOrThrow({ where: { id: account.id }, select: { currentBalance: true } });
      if (toPaisa(fresh.currentBalance) < amountPaisa) {
        throw new BadRequestException("This wallet doesn't have that much. Pick another wallet or give less.");
      }
      const expenseAccountId = await this.expenseAccountId(tx, businessId);
      await this.ensureZakatCategory(tx, businessId);
      const posted = await this.transactions.createTransaction(
        businessId,
        {
          transactionType: 'EXPENSE',
          transactionDate: dto.paidOn,
          description: dto.givenTo ? `Zakat · ${dto.givenTo}` : 'Zakat',
          entries: [
            { accountId: expenseAccountId, entryType: 'DEBIT', amount: dto.amount, categoryId: ZAKAT_CATEGORY },
            { accountId: account.id, entryType: 'CREDIT', amount: dto.amount },
          ],
        },
        userId,
        tx,
      );
      await tx.zakatPayment.create({
        data: {
          businessId,
          dueDate: due,
          amount: new Prisma.Decimal(money(amountPaisa)),
          paidOn: new Date(`${dto.paidOn}T00:00:00Z`),
          accountId: account.id,
          transactionId: posted.id,
          givenTo: dto.givenTo || null,
          createdBy: userId,
        },
      });
    });
    return this.summary(businessId);
  }

  // The record goes and its expense is voided, together.
  async deletePayment(businessId: string, id: string, userId: string) {
    await this.prisma.$transaction(async (tx) => {
      const payment = await tx.zakatPayment.findFirst({ where: { id, businessId } });
      if (!payment) throw new NotFoundException('Not found');
      await tx.zakatPayment.delete({ where: { id } });
      await this.transactions.voidTransaction(businessId, payment.transactionId, 'Zakat entry deleted', userId, tx);
    });
    return this.summary(businessId);
  }

  // --- Helpers ---

  // The workspace's choices, made with the defaults on first use.
  private async profile(businessId: string, client: Client = this.prisma): Promise<ZakatProfile> {
    await client.zakatProfile.createMany({ data: [{ businessId }], skipDuplicates: true });
    return client.zakatProfile.findUniqueOrThrow({ where: { businessId } });
  }

  private checkedFor(profile: ZakatProfile, dueDate: string): ZakatStep[] {
    const checked = profile.checked as { dueDate?: string; steps?: ZakatStep[] } | null;
    return checked?.dueDate === dueDate && Array.isArray(checked.steps) ? checked.steps : [];
  }

  private async uncheck(businessId: string, group: ZakatGroup) {
    const profile = await this.profile(businessId);
    const checked = profile.checked as { dueDate?: string; steps?: ZakatStep[] } | null;
    if (!checked?.steps?.includes(group)) return;
    await this.prisma.zakatProfile.update({
      where: { businessId },
      data: { checked: { dueDate: checked.dueDate ?? null, steps: checked.steps.filter((s) => s !== group) } },
    });
  }

  // Adds or takes a value off one of the profile's lists, in one statement
  // so two taps at once both land.
  private async editList(businessId: string, field: 'excluded' | 'debtFull' | 'forSale', value: string, present: boolean) {
    const profile = await this.profile(businessId);
    if (present && profile[field].length >= MAX_KEYS && !profile[field].includes(value)) throw new ConflictException('Too many lines changed');
    if (present) {
      await this.prisma
        .$executeRaw`UPDATE "ZakatProfile" SET ${Prisma.raw(`"${field}"`)} = array_append(array_remove(${Prisma.raw(`"${field}"`)}, ${value}), ${value}), "updatedAt" = NOW() WHERE "businessId" = ${businessId}`;
    } else {
      await this.prisma
        .$executeRaw`UPDATE "ZakatProfile" SET ${Prisma.raw(`"${field}"`)} = array_remove(${Prisma.raw(`"${field}"`)}, ${value}), "updatedAt" = NOW() WHERE "businessId" = ${businessId}`;
    }
  }

  private async requireOwn(
    model: { count: (args: { where: { id: string; businessId: string } }) => Promise<number> },
    businessId: string,
    id: string,
    label: string,
  ) {
    if ((await model.count({ where: { id, businessId } })) === 0) throw new NotFoundException(`${label} not found`);
  }

  // The workspace's first expense account (the seeded one wins a tie).
  private async expenseAccountId(client: Client, businessId: string): Promise<string> {
    const account = await client.account.findFirst({
      where: { businessId, accountType: 'EXPENSE', status: 'ACTIVE' },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true },
    });
    if (!account) throw new BadRequestException('This workspace has no expense account');
    return account.id;
  }

  private async ensureZakatCategory(client: Client, businessId: string) {
    const exists = await client.budgetCategory.count({ where: { businessId, type: 'EXPENSE', name: ZAKAT_CATEGORY } });
    if (exists) return;
    const siblings = await client.budgetCategory.findMany({ where: { businessId, type: 'EXPENSE' }, select: { color: true } });
    await client.budgetCategory.createMany({
      data: [
        {
          businessId,
          type: 'EXPENSE',
          name: ZAKAT_CATEGORY,
          icon: 'heart',
          color: nextCategoryColor(siblings.map((s) => s.color)),
          displayOrder: siblings.length,
        },
      ],
      skipDuplicates: true,
    });
  }
}
