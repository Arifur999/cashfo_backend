import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Account, Investment, InvestmentEntry, InvestmentEntryType, Prisma } from '@prisma/client';
import { INVESTMENTS_ACCOUNT_SUBTYPE, MONEY_ACCOUNT_SUBTYPES } from '../accounts/accounts.service.js';
import { dhakaDateKey } from '../common/dhaka.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RESTORE_WINDOW_MINUTES, TransactionsService } from '../transactions/transactions.service.js';
import { CloseInvestmentDto, InvestmentDto, InvestmentEntryDto, UpdateInvestmentEntryDto } from './dto/investment.dto.js';
import { capitalStaysPositive, dateOf, dayOf, figuresOf, type FigureEntry } from './investment-figures.js';

// The reasons the investment pages void a posting with. An undone delete
// brings back only postings voided with its own reason.
export const INVESTMENT_DELETED_REASON = 'Investment deleted';
export const INVESTMENT_ENTRY_DELETED_REASON = 'Investment entry deleted';
const CORRECTED_REASON = 'Investment entry corrected';
const CLOSE_UNDONE_REASON = 'Investment close undone';

// The income category a profit is filed under (categories are names).
export const INVESTMENT_PROFIT_CATEGORY = 'Investment profit';

const ENTRY_ORDER = [{ date: 'asc' as const }, { createdAt: 'asc' as const }];

type Client = Prisma.TransactionClient;
type EntryRow = InvestmentEntry;

// What a deleted investment or entry was, for its Undo.
interface EntrySnapshot {
  id: string;
  type: InvestmentEntryType;
  date: string;
  amount: string;
  accountId: string | null;
  transactionId: string | null;
  note: string | null;
  fromClose: boolean;
  createdAt: string;
}
interface InvestmentSnapshot {
  investment: Omit<Investment, 'startDate' | 'firstDueDate' | 'maturityDate' | 'closedAt' | 'createdAt' | 'updatedAt' | 'fixedAmount' | 'ratePercent'> & {
    startDate: string;
    firstDueDate: string | null;
    maturityDate: string | null;
    closedAt: string | null;
    createdAt: string;
    fixedAmount: string | null;
    ratePercent: string | null;
  };
  entries: EntrySnapshot[];
}

const toFigure = (entry: Pick<EntryRow, 'type' | 'amount' | 'date'>): FigureEntry => ({ type: entry.type, amount: entry.amount, day: dayOf(entry.date) });

const snapshotOfEntry = (entry: EntryRow): EntrySnapshot => ({
  id: entry.id,
  type: entry.type,
  date: dayOf(entry.date),
  amount: new Prisma.Decimal(entry.amount).toFixed(2),
  accountId: entry.accountId,
  transactionId: entry.transactionId,
  note: entry.note,
  fromClose: entry.fromClose,
  createdAt: entry.createdAt.toISOString(),
});

@Injectable()
export class InvestmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactionsService: TransactionsService,
  ) {}

  // Every investment of the workspace with its entries (oldest first) and
  // what they add up to.
  async list(businessId: string) {
    const investments = await this.prisma.investment.findMany({
      where: { businessId },
      include: { entries: { orderBy: ENTRY_ORDER } },
      orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }],
    });
    return investments.map((investment) => this.present(investment));
  }

  private present(investment: Investment & { entries: EntryRow[] }) {
    const figures = figuresOf(investment.entries.map(toFigure));
    return {
      ...investment,
      put: figures.put.toFixed(2),
      back: figures.back.toFixed(2),
      loss: figures.loss.toFixed(2),
      profit: figures.profit.toFixed(2),
      capital: figures.capital.toFixed(2),
    };
  }

  private async fetch(id: string, client: Client = this.prisma) {
    const investment = await client.investment.findUniqueOrThrow({ where: { id }, include: { entries: { orderBy: ENTRY_ORDER } } });
    return this.present(investment);
  }

  // ---- New / edit investment ----

  // A new investment: its first money put in is an INVEST entry, posted out
  // of the wallet it came from (none when it was put in earlier).
  async create(businessId: string, dto: InvestmentDto, userId: string) {
    const plan = this.planOf(dto);
    const today = dhakaDateKey(new Date());
    this.requireNotFuture(dto.startDate, today, 'The date');
    const keys = [`investments:${businessId}`];
    if (dto.sourceAccountId) keys.push(`account:${dto.sourceAccountId}`);
    const id = await this.transactionsService.withLocks(keys, async (tx) => {
      await this.requireWallet(businessId, dto.profitAccountId, tx);
      const source = dto.sourceAccountId ? await this.requireWallet(businessId, dto.sourceAccountId, tx) : null;
      const investment = await tx.investment.create({
        data: {
          businessId,
          name: dto.name,
          kind: dto.kind,
          startDate: dateOf(dto.startDate),
          profitAccountId: dto.profitAccountId,
          note: dto.note || null,
          ...plan,
        },
      });
      const transactionId = source ? (await this.post(tx, businessId, userId, investment.name, 'INVEST', dto.startDate, dto.amount, source.id, null)).id : null;
      await tx.investmentEntry.create({
        data: {
          investmentId: investment.id,
          businessId,
          type: 'INVEST',
          date: dateOf(dto.startDate),
          amount: dto.amount,
          accountId: source?.id ?? null,
          transactionId,
        },
      });
      return investment.id;
    });
    return this.fetch(id);
  }

  // Edit investment: its plan and details, and its first money put in (the
  // amount, the day and the wallet). A change to the money voids the old
  // posting and posts the new one in the same commit. The first day stays on
  // or before every other entry, and capital never goes below zero.
  async update(businessId: string, id: string, dto: InvestmentDto, userId: string) {
    const plan = this.planOf(dto);
    const today = dhakaDateKey(new Date());
    this.requireNotFuture(dto.startDate, today, 'The date');
    const before = await this.requireInvestment(businessId, id);
    const first = before.entries.find((entry) => entry.type === 'INVEST');
    const keys = [`investment:${id}`, `investments:${businessId}`];
    if (first?.accountId) keys.push(`account:${first.accountId}`);
    if (dto.sourceAccountId) keys.push(`account:${dto.sourceAccountId}`);
    await this.transactionsService.withLocks(keys, async (tx) => {
      const investment = await this.requireInvestment(businessId, id, tx);
      const invest = investment.entries.find((entry) => entry.type === 'INVEST');
      if ((invest?.accountId ?? null) !== (first?.accountId ?? null)) {
        throw new ConflictException('This investment changed meanwhile. Reload and try again.');
      }
      if (investment.entries.some((entry) => entry.type !== 'INVEST' && dayOf(entry.date) < dto.startDate)) {
        throw new BadRequestException('Some entries are dated before this day. Move the date to on or before the first entry.');
      }
      if (investment.closedAt && dayOf(investment.closedAt) < dto.startDate) {
        throw new BadRequestException("The date can't be after the day the investment was closed.");
      }
      const others = investment.entries.filter((entry) => entry.id !== invest?.id).map(toFigure);
      if (!capitalStaysPositive([...others, { type: 'INVEST', amount: dto.amount, day: dto.startDate }])) {
        throw new BadRequestException('More capital has been taken back or lost than this amount. Raise the amount, or change those entries first.');
      }
      await this.requireWallet(businessId, dto.profitAccountId, tx, investment.profitAccountId);
      const nextSource = dto.sourceAccountId ? await this.requireWallet(businessId, dto.sourceAccountId, tx, invest?.accountId) : null;
      await tx.investment.update({
        where: { id },
        data: { name: dto.name, kind: dto.kind, startDate: dateOf(dto.startDate), profitAccountId: dto.profitAccountId, note: dto.note || null, ...plan },
      });
      const moneyChanged =
        !invest ||
        !new Prisma.Decimal(invest.amount).equals(dto.amount) ||
        dayOf(invest.date) !== dto.startDate ||
        (invest.accountId ?? null) !== (nextSource?.id ?? null);
      if (!moneyChanged) return;
      if (invest) await this.voidPosting(tx, businessId, invest, CORRECTED_REASON, userId);
      const transactionId = nextSource
        ? (await this.post(tx, businessId, userId, dto.name, 'INVEST', dto.startDate, dto.amount, nextSource.id, null)).id
        : null;
      if (invest) {
        await tx.investmentEntry.update({
          where: { id: invest.id },
          data: { date: dateOf(dto.startDate), amount: dto.amount, accountId: nextSource?.id ?? null, transactionId },
        });
      } else {
        await tx.investmentEntry.create({
          data: {
            investmentId: id,
            businessId,
            type: 'INVEST',
            date: dateOf(dto.startDate),
            amount: dto.amount,
            accountId: nextSource?.id ?? null,
            transactionId,
          },
        });
      }
    });
    return this.fetch(id);
  }

  // The payout plan a form describes, made consistent: profit at no fixed
  // time has no amount and no first day; an amount is a fixed sum or a
  // yearly rate, never both.
  private planOf(dto: InvestmentDto) {
    const scheduled = dto.frequency !== 'IRREGULAR';
    const mode = scheduled ? dto.payoutMode : 'NONE';
    const firstDue = scheduled ? (dto.firstDueDate ?? null) : null;
    if (scheduled && !firstDue) throw new BadRequestException('Pick the first profit date.');
    if (firstDue && firstDue <= dto.startDate) throw new BadRequestException('The first profit comes after the date you invested.');
    if (dto.maturityDate && dto.maturityDate <= dto.startDate) throw new BadRequestException('The end date comes after the date you invested.');
    return {
      frequency: dto.frequency,
      payoutMode: mode,
      fixedAmount: mode === 'FIXED' ? dto.fixedAmount! : null,
      ratePercent: mode === 'RATE' ? dto.ratePercent! : null,
      firstDueDate: firstDue ? dateOf(firstDue) : null,
      maturityDate: dto.maturityDate ? dateOf(dto.maturityDate) : null,
    };
  }

  // ---- Entries ----

  // Record profit, Invest more, Take capital back or Record a loss, under
  // the investment's lock: two takes from one investment can't both pass
  // the capital check on the same money.
  async addEntry(businessId: string, id: string, dto: InvestmentEntryDto, userId: string) {
    const today = dhakaDateKey(new Date());
    this.requireNotFuture(dto.date, today, 'The date');
    const accountId = dto.type === 'LOSS' ? null : (dto.accountId ?? null);
    const keys = [`investment:${id}`, `investments:${businessId}`];
    if (accountId) keys.push(`account:${accountId}`);
    const entryId = await this.transactionsService.withLocks(keys, async (tx) => {
      const investment = await this.requireInvestment(businessId, id, tx);
      if (investment.closedAt) throw new BadRequestException('This investment is closed. Reopen it to add entries.');
      this.requireOnOrAfterStart(dto.date, investment);
      if (!capitalStaysPositive([...investment.entries.map(toFigure), { type: dto.type, amount: dto.amount, day: dto.date }])) {
        throw new BadRequestException(`This is more than the capital left (${figuresOf(investment.entries.map(toFigure)).capital.toFixed(2)}).`);
      }
      const wallet = accountId ? await this.requireWallet(businessId, accountId, tx) : null;
      const posting = wallet ? await this.post(tx, businessId, userId, investment.name, dto.type, dto.date, dto.amount, wallet.id, dto.note || null) : null;
      const entry = await tx.investmentEntry.create({
        data: {
          investmentId: id,
          businessId,
          type: dto.type,
          date: dateOf(dto.date),
          amount: dto.amount,
          accountId: wallet?.id ?? null,
          transactionId: posting?.id ?? null,
          note: dto.note || null,
        },
      });
      return entry.id;
    });
    return { entryId, investment: await this.fetch(id) };
  }

  // Edit entry: its amount, day, wallet or note; its type stays. The first
  // money put in is edited with the investment itself.
  async updateEntry(businessId: string, id: string, entryId: string, dto: UpdateInvestmentEntryDto, userId: string) {
    const today = dhakaDateKey(new Date());
    this.requireNotFuture(dto.date, today, 'The date');
    const before = await this.requireEntry(businessId, id, entryId);
    const nextAccountId = before.type === 'LOSS' ? null : (dto.accountId ?? before.accountId);
    if (before.type !== 'LOSS' && !nextAccountId) throw new BadRequestException('Pick an account.');
    const keys = [`investment:${id}`, `investments:${businessId}`];
    if (before.accountId) keys.push(`account:${before.accountId}`);
    if (nextAccountId) keys.push(`account:${nextAccountId}`);
    await this.transactionsService.withLocks(keys, async (tx) => {
      const investment = await this.requireInvestment(businessId, id, tx);
      const entry = investment.entries.find((row) => row.id === entryId);
      if (!entry) throw new NotFoundException('Entry not found');
      if (entry.type === 'INVEST') throw new BadRequestException('Edit the investment to change the first amount.');
      if (entry.accountId !== before.accountId) throw new ConflictException('This entry changed meanwhile. Reload and try again.');
      this.requireOnOrAfterStart(dto.date, investment);
      if (investment.closedAt && dto.date > dayOf(investment.closedAt)) {
        throw new BadRequestException("The date can't be after the day the investment was closed.");
      }
      const rest = investment.entries.filter((row) => row.id !== entryId).map(toFigure);
      if (!capitalStaysPositive([...rest, { type: entry.type, amount: dto.amount, day: dto.date }])) {
        throw new BadRequestException(`This is more than the capital left (${figuresOf(rest).capital.toFixed(2)}).`);
      }
      const wallet = nextAccountId ? await this.requireWallet(businessId, nextAccountId, tx, entry.accountId) : null;
      const note = dto.note === undefined ? entry.note : dto.note || null;
      const moneyChanged =
        !new Prisma.Decimal(entry.amount).equals(dto.amount) || dayOf(entry.date) !== dto.date || (entry.accountId ?? null) !== (wallet?.id ?? null);
      let transactionId = entry.transactionId;
      if (moneyChanged && entry.type !== 'LOSS') {
        await this.voidPosting(tx, businessId, entry, CORRECTED_REASON, userId);
        transactionId = wallet ? (await this.post(tx, businessId, userId, investment.name, entry.type, dto.date, dto.amount, wallet.id, note)).id : null;
      }
      await tx.investmentEntry.update({
        where: { id: entryId },
        data: { amount: dto.amount, date: dateOf(dto.date), accountId: wallet?.id ?? null, transactionId, note },
      });
    });
    return this.fetch(id);
  }

  // Deletes an entry made by mistake and keeps it for a few minutes so the
  // delete can be undone (restoreEntry). Its posting is voided in the same
  // commit. The first money put in goes only with the investment.
  async removeEntry(businessId: string, id: string, entryId: string, userId: string) {
    const before = await this.requireEntry(businessId, id, entryId);
    const keys = [`investment:${id}`];
    if (before.accountId) keys.push(`account:${before.accountId}`);
    await this.transactionsService.withLocks(keys, async (tx) => {
      const investment = await this.requireInvestment(businessId, id, tx);
      const entry = investment.entries.find((row) => row.id === entryId);
      if (!entry) throw new NotFoundException('Entry not found');
      if (entry.type === 'INVEST') throw new BadRequestException('The first amount goes only with the investment. Delete the investment instead.');
      if (!capitalStaysPositive(investment.entries.filter((row) => row.id !== entryId).map(toFigure))) {
        throw new BadRequestException('More capital has been taken back or lost than is left without this. Change those entries first.');
      }
      await tx.investmentEntry.delete({ where: { id: entryId } });
      await this.voidPosting(tx, businessId, entry, INVESTMENT_ENTRY_DELETED_REASON, userId);
      const snapshot = snapshotOfEntry(entry) as unknown as Prisma.InputJsonValue;
      await tx.investmentDeletion.upsert({
        where: { id: entryId },
        create: { id: entryId, kind: 'ENTRY', businessId, investmentId: id, deletedBy: userId, snapshot },
        update: { businessId, investmentId: id, deletedBy: userId, deletedAt: new Date(), snapshot },
      });
    });
    return this.fetch(id);
  }

  // Undo of an entry's delete: it comes back with its posting standing again.
  async restoreEntry(businessId: string, id: string, entryId: string, userId: string, now = new Date()) {
    const deletion = await this.requireDeletion(businessId, entryId, 'ENTRY', userId, now);
    const entry = deletion.snapshot as unknown as EntrySnapshot;
    const keys = [`investment:${id}`];
    if (entry.accountId) keys.push(`account:${entry.accountId}`);
    await this.transactionsService.withLocks(keys, async (tx) => {
      const investment = await this.requireInvestment(businessId, deletion.investmentId, tx);
      if (investment.id !== id) throw new NotFoundException('This delete can no longer be undone.');
      await this.claimDeletion(tx, businessId, entryId);
      if (!capitalStaysPositive([...investment.entries.map(toFigure), { type: entry.type, amount: entry.amount, day: entry.date }])) {
        throw new BadRequestException('Bringing this back would take more capital than is left.');
      }
      if (entry.transactionId) await this.transactionsService.reinstateVoided(tx, businessId, entry.transactionId, INVESTMENT_ENTRY_DELETED_REASON);
      await tx.investmentEntry.create({ data: this.entryFromSnapshot(entry, id, businessId) });
    });
    return this.fetch(id);
  }

  // ---- Close / reopen ----

  // Close investment: what came back in the end. Up to the capital it is
  // capital back, past it the extra is profit, and short of it the rest is
  // a loss. All of it lands on the day written, in one commit.
  async close(businessId: string, id: string, dto: CloseInvestmentDto, userId: string) {
    const today = dhakaDateKey(new Date());
    this.requireNotFuture(dto.date, today, 'The date');
    const accountId = dto.amount > 0 ? (dto.accountId ?? null) : null;
    const keys = [`investment:${id}`, `investments:${businessId}`];
    if (accountId) keys.push(`account:${accountId}`);
    await this.transactionsService.withLocks(keys, async (tx) => {
      const investment = await this.requireInvestment(businessId, id, tx);
      if (investment.closedAt) throw new BadRequestException('This investment is closed already.');
      this.requireOnOrAfterStart(dto.date, investment);
      const lastDay = investment.entries
        .map((entry) => dayOf(entry.date))
        .sort()
        .at(-1);
      if (lastDay && dto.date < lastDay) throw new BadRequestException('Close on or after the last entry.');
      const wallet = accountId ? await this.requireWallet(businessId, accountId, tx) : null;
      const capital = figuresOf(investment.entries.map(toFigure)).capital;
      const got = new Prisma.Decimal(dto.amount);
      const note = dto.note || null;
      const back = Prisma.Decimal.min(got, capital);
      const parts: { type: 'BACK' | 'PROFIT' | 'LOSS'; amount: Prisma.Decimal; note: string }[] = [];
      if (back.greaterThan(0)) parts.push({ type: 'BACK', amount: back, note: note ?? 'Closed, capital back' });
      if (got.greaterThan(capital)) parts.push({ type: 'PROFIT', amount: got.minus(capital), note: 'Extra at closing' });
      if (got.lessThan(capital)) parts.push({ type: 'LOSS', amount: capital.minus(got), note: 'Not paid back at closing' });
      for (const part of parts) {
        const moves = part.type !== 'LOSS' && wallet;
        const posting = moves ? await this.post(tx, businessId, userId, investment.name, part.type, dto.date, part.amount, wallet.id, part.note) : null;
        await tx.investmentEntry.create({
          data: {
            investmentId: id,
            businessId,
            type: part.type,
            date: dateOf(dto.date),
            amount: part.amount,
            accountId: moves ? wallet.id : null,
            transactionId: posting?.id ?? null,
            note: part.note,
            fromClose: true,
          },
        });
      }
      await tx.investment.update({ where: { id }, data: { closedAt: dateOf(dto.date) } });
    });
    return this.fetch(id);
  }

  // Undo of a close: the entries the close made go (their postings voided)
  // and the investment is open again.
  async undoClose(businessId: string, id: string, userId: string) {
    const before = await this.requireInvestment(businessId, id);
    const keys = [`investment:${id}`, ...before.entries.filter((entry) => entry.fromClose && entry.accountId).map((entry) => `account:${entry.accountId}`)];
    await this.transactionsService.withLocks(keys, async (tx) => {
      const investment = await this.requireInvestment(businessId, id, tx);
      if (!investment.closedAt) throw new BadRequestException('This investment is open.');
      const made = investment.entries.filter((entry) => entry.fromClose);
      if (made.some((entry) => entry.accountId && !before.entries.some((row) => row.id === entry.id))) {
        throw new ConflictException('This investment changed meanwhile. Reload and try again.');
      }
      for (const entry of made) {
        await tx.investmentEntry.delete({ where: { id: entry.id } });
        await this.voidPosting(tx, businessId, entry, CLOSE_UNDONE_REASON, userId);
      }
      await tx.investment.update({ where: { id }, data: { closedAt: null } });
    });
    return this.fetch(id);
  }

  // Reopen: the investment takes entries again. What the close recorded
  // stays; its entries are no longer the close's (an undo can't take them).
  async reopen(businessId: string, id: string) {
    await this.prisma.$transaction(async (tx) => {
      const investment = await this.requireInvestment(businessId, id, tx);
      if (!investment.closedAt) throw new BadRequestException('This investment is open.');
      await tx.investmentEntry.updateMany({ where: { investmentId: id, fromClose: true }, data: { fromClose: false } });
      await tx.investment.update({ where: { id }, data: { closedAt: null } });
    });
    return this.fetch(id);
  }

  // ---- Delete / restore ----

  // Takes away an investment entered by mistake with all its entries, and
  // keeps it for a few minutes so the delete can be undone (restore()).
  // Every posting is voided in the same commit, so the wallets are as if it
  // never happened.
  async remove(businessId: string, id: string, userId: string) {
    const before = await this.requireInvestment(businessId, id);
    const keys = [`investment:${id}`, ...before.entries.filter((entry) => entry.accountId).map((entry) => `account:${entry.accountId}`)];
    await this.transactionsService.withLocks(keys, async (tx) => {
      const investment = await this.requireInvestment(businessId, id, tx);
      if (investment.entries.some((entry) => entry.accountId && !keys.includes(`account:${entry.accountId}`))) {
        throw new ConflictException('This investment changed meanwhile. Reload and try again.');
      }
      const snapshot: InvestmentSnapshot = {
        investment: {
          id: investment.id,
          businessId: investment.businessId,
          name: investment.name,
          kind: investment.kind,
          frequency: investment.frequency,
          payoutMode: investment.payoutMode,
          profitAccountId: investment.profitAccountId,
          note: investment.note,
          startDate: dayOf(investment.startDate),
          firstDueDate: investment.firstDueDate ? dayOf(investment.firstDueDate) : null,
          maturityDate: investment.maturityDate ? dayOf(investment.maturityDate) : null,
          closedAt: investment.closedAt ? dayOf(investment.closedAt) : null,
          createdAt: investment.createdAt.toISOString(),
          fixedAmount: investment.fixedAmount === null ? null : new Prisma.Decimal(investment.fixedAmount).toFixed(2),
          ratePercent: investment.ratePercent === null ? null : new Prisma.Decimal(investment.ratePercent).toFixed(2),
        },
        entries: investment.entries.map(snapshotOfEntry),
      };
      // The entries go first, so the voids find no entry owning the postings.
      await tx.investmentEntry.deleteMany({ where: { investmentId: id } });
      await tx.investment.delete({ where: { id } });
      for (const entry of investment.entries) {
        await this.voidPosting(tx, businessId, entry, INVESTMENT_DELETED_REASON, userId);
      }
      await tx.investmentDeletion.deleteMany({ where: { investmentId: id, kind: 'ENTRY' } });
      const json = snapshot as unknown as Prisma.InputJsonValue;
      await tx.investmentDeletion.upsert({
        where: { id },
        create: { id, kind: 'INVESTMENT', businessId, investmentId: id, deletedBy: userId, snapshot: json },
        update: { businessId, investmentId: id, deletedBy: userId, deletedAt: new Date(), snapshot: json },
      });
    });
    return { id };
  }

  // Undo of a delete: the investment and its entries come back as they were,
  // their postings standing again (not posted anew, so the wallets'
  // statements read as before).
  async restore(businessId: string, id: string, userId: string, now = new Date()) {
    const deletion = await this.requireDeletion(businessId, id, 'INVESTMENT', userId, now);
    const { investment, entries } = deletion.snapshot as unknown as InvestmentSnapshot;
    const keys = [`investment:${id}`, ...entries.filter((entry) => entry.accountId).map((entry) => `account:${entry.accountId}`)];
    await this.transactionsService.withLocks(keys, async (tx) => {
      await this.claimDeletion(tx, businessId, id);
      for (const entry of entries) {
        if (entry.transactionId) await this.transactionsService.reinstateVoided(tx, businessId, entry.transactionId, INVESTMENT_DELETED_REASON);
      }
      await tx.investment.create({
        data: {
          ...investment,
          startDate: dateOf(investment.startDate),
          firstDueDate: investment.firstDueDate ? dateOf(investment.firstDueDate) : null,
          maturityDate: investment.maturityDate ? dateOf(investment.maturityDate) : null,
          closedAt: investment.closedAt ? dateOf(investment.closedAt) : null,
          createdAt: new Date(investment.createdAt),
        },
      });
      await tx.investmentEntry.createMany({ data: entries.map((entry) => this.entryFromSnapshot(entry, id, businessId)) });
    });
    return this.fetch(id);
  }

  // Deletes past the undo window are final: their snapshots go.
  async purgeDeletions(now: Date) {
    const { count } = await this.prisma.investmentDeletion.deleteMany({
      where: { deletedAt: { lt: new Date(now.getTime() - RESTORE_WINDOW_MINUTES * 60_000) } },
    });
    return count;
  }

  private entryFromSnapshot(entry: EntrySnapshot, investmentId: string, businessId: string): Prisma.InvestmentEntryCreateManyInput {
    return {
      id: entry.id,
      investmentId,
      businessId,
      type: entry.type,
      date: dateOf(entry.date),
      amount: entry.amount,
      accountId: entry.accountId,
      transactionId: entry.transactionId,
      note: entry.note,
      fromClose: entry.fromClose,
      createdAt: new Date(entry.createdAt),
    };
  }

  private async requireDeletion(businessId: string, id: string, kind: 'INVESTMENT' | 'ENTRY', userId: string, now: Date) {
    const deletion = await this.prisma.investmentDeletion.findUnique({ where: { id } });
    if (!deletion || deletion.businessId !== businessId || deletion.kind !== kind) {
      throw new NotFoundException('This delete can no longer be undone.');
    }
    if (deletion.deletedBy !== userId) throw new ForbiddenException('Only the person who deleted it can undo the delete');
    if (now.getTime() - deletion.deletedAt.getTime() > RESTORE_WINDOW_MINUTES * 60_000) {
      throw new BadRequestException('A delete can be undone for 10 minutes only');
    }
    return deletion;
  }

  // Claimed with a condition: of two undos racing, only one gets past here.
  private async claimDeletion(tx: Client, businessId: string, id: string) {
    const claimed = await tx.investmentDeletion.deleteMany({ where: { id, businessId } });
    if (claimed.count === 0) throw new BadRequestException('This is back already');
  }

  // ---- Postings ----

  // An entry's posting. Money put in leaves the wallet into the pooled
  // investments account; capital back comes out of it; a profit is income
  // into the wallet. A loss moves no money and has none.
  private async post(
    tx: Client,
    businessId: string,
    userId: string,
    name: string,
    type: InvestmentEntryType,
    day: string,
    amount: number | Prisma.Decimal,
    walletId: string,
    note: string | null,
  ) {
    const value = Number(amount);
    const describe = (what: string) => (note ? `${what}: ${name} -- ${note}` : `${what}: ${name}`);
    if (type === 'PROFIT') {
      const income = await this.requireProfitIncomeAccount(businessId, tx);
      return this.transactionsService.createTransaction(
        businessId,
        {
          transactionType: 'INCOME',
          transactionDate: day,
          description: describe('Investment profit'),
          entries: [
            { accountId: walletId, entryType: 'DEBIT', amount: value },
            { accountId: income.id, entryType: 'CREDIT', amount: value, categoryId: INVESTMENT_PROFIT_CATEGORY, note: note ?? undefined },
          ],
        },
        userId,
        tx,
      );
    }
    if (type === 'LOSS') throw new BadRequestException('A loss moves no money.');
    const pool = await this.requireOrCreateInvestmentsAccount(businessId, tx);
    const out = type === 'INVEST' || type === 'ADD';
    return this.transactionsService.createTransaction(
      businessId,
      {
        transactionType: 'JOURNAL',
        transactionDate: day,
        description: describe(out ? 'Investment' : 'Investment return'),
        entries: [
          { accountId: out ? pool.id : walletId, entryType: 'DEBIT', amount: value },
          { accountId: out ? walletId : pool.id, entryType: 'CREDIT', amount: value, note: note ?? undefined },
        ],
      },
      userId,
      tx,
    );
  }

  // Voids an entry's posting when it still holds its money. Called once the
  // entry no longer owns it (deleted, or about to point at a new one), or
  // the void would be refused as an investment's.
  private async voidPosting(tx: Client, businessId: string, entry: Pick<EntryRow, 'id' | 'transactionId'>, reason: string, userId: string) {
    const transactionId = entry.transactionId;
    if (!transactionId) return;
    const posting = await tx.transaction.findUnique({ where: { id: transactionId }, select: { status: true } });
    if (posting?.status !== 'POSTED') return;
    await tx.investmentEntry.updateMany({ where: { id: entry.id, transactionId }, data: { transactionId: null } });
    await this.transactionsService.voidTransaction(businessId, transactionId, reason, userId, tx);
  }

  // ---- Lookups ----

  private async requireInvestment(businessId: string, id: string, client: Client = this.prisma) {
    const investment = await client.investment.findUnique({ where: { id }, include: { entries: { orderBy: ENTRY_ORDER } } });
    if (!investment || investment.businessId !== businessId) throw new NotFoundException('Investment not found');
    return investment;
  }

  private async requireEntry(businessId: string, id: string, entryId: string) {
    const entry = await this.prisma.investmentEntry.findUnique({ where: { id: entryId } });
    if (!entry || entry.businessId !== businessId || entry.investmentId !== id) throw new NotFoundException('Entry not found');
    return entry;
  }

  private requireNotFuture(day: string, today: string, what: string) {
    if (day > today) throw new BadRequestException(`${what} cannot be in the future.`);
  }

  private requireOnOrAfterStart(day: string, investment: Pick<Investment, 'startDate'>) {
    if (day < dayOf(investment.startDate)) throw new BadRequestException(`This is before the investment started (${dayOf(investment.startDate)}).`);
  }

  // A cash, bank or mobile wallet of this workspace, still in use; one the
  // record already names stays accepted after it was archived.
  private async requireWallet(businessId: string, accountId: string, client: Client, keep?: string | null): Promise<Account> {
    const account = await client.account.findUnique({ where: { id: accountId } });
    if (!account || account.businessId !== businessId) throw new BadRequestException('Account not found in this workspace');
    if (account.accountType !== 'ASSET' || !account.accountSubtype || !MONEY_ACCOUNT_SUBTYPES.includes(account.accountSubtype)) {
      throw new BadRequestException('Pick a cash, bank or mobile wallet account');
    }
    if (account.status !== 'ACTIVE' && account.id !== keep) throw new BadRequestException(`"${account.name}" is archived. Pick another account.`);
    return account;
  }

  // The income account a profit is credited to: one named for profit or
  // interest, else the first.
  private async requireProfitIncomeAccount(businessId: string, client: Client): Promise<Account> {
    const accounts = await client.account.findMany({
      where: { businessId, accountType: 'INCOME', status: 'ACTIVE' },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    });
    const account = accounts.find((a) => /profit|interest/i.test(a.name)) ?? accounts[0];
    if (!account) throw new BadRequestException('Add an income category first, to count the profit under.');
    return account;
  }

  // The hidden pooled account every investment's capital moves through,
  // like the assets' fixed-assets account: outside the money subtypes, so
  // no wallet list or total sees it. Callers hold `investments:<businessId>`,
  // so two first-ever investments can't each create one.
  private async requireOrCreateInvestmentsAccount(businessId: string, client: Client): Promise<Account> {
    const existing = await client.account.findFirst({ where: { businessId, accountSubtype: INVESTMENTS_ACCOUNT_SUBTYPE, isSystemAccount: true } });
    if (existing) return existing;
    return client.account.create({
      data: {
        businessId,
        name: 'Investments (Internal)',
        accountType: 'ASSET',
        accountSubtype: INVESTMENTS_ACCOUNT_SUBTYPE,
        isSystemAccount: true,
        openingBalance: 0,
        currentBalance: 0,
      },
    });
  }
}
