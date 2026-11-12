import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Account, Asset, Prisma } from '@prisma/client';
import { FIXED_ASSETS_ACCOUNT_SUBTYPE, MONEY_ACCOUNT_SUBTYPES } from '../accounts/accounts.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RESTORE_WINDOW_MINUTES, TransactionsService } from '../transactions/transactions.service.js';
import { canMovePurchaseTo, isBeforePurchase, isNewestValuation, purchaseRowOf } from './asset-dates.js';
import { CreateAssetCategoryDto } from './dto/create-asset-category.dto.js';
import { CreateAssetPurchaseDto } from './dto/create-asset-purchase.dto.js';
import { SellAssetDto } from './dto/sell-asset.dto.js';
import { UpdateAssetCategoryDto } from './dto/update-asset-category.dto.js';
import { UpdateAssetValueDto } from './dto/update-asset-value.dto.js';
import { UpdateAssetDto } from './dto/update-asset.dto.js';

const VALUE_HISTORY_ORDER = { recordedAt: 'desc' as const };

// The reason an asset's postings are voided with when the asset is deleted:
// an undone delete brings back only postings voided this way.
export const ASSET_DELETED_REASON = 'Asset deleted';

// The notes the first history row carries: paid from a wallet, or owned.
const PAID_ROW_NOTE = 'Initial purchase value';
const OWNED_ROW_NOTE = 'Initial value';

const dayOf = (date: Date): string => date.toISOString().slice(0, 10);

// A deleted asset as it was, for the undo: its row and its value history.
interface AssetSnapshot {
  asset: Omit<Asset, 'purchaseDate' | 'soldAt' | 'createdAt' | 'updatedAt' | 'purchasePrice' | 'currentValue' | 'soldPrice' | 'weightVori'> & {
    purchaseDate: string;
    soldAt: string | null;
    createdAt: string;
    purchasePrice: string;
    currentValue: string;
    soldPrice: string | null;
    weightVori: string | null;
  };
  history: { id: string; value: string; recordedAt: string; note: string | null }[];
}

@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactionsService: TransactionsService,
  ) {}

  async list(businessId: string) {
    return this.prisma.asset.findMany({
      where: { businessId },
      include: { valueHistory: { orderBy: VALUE_HISTORY_ORDER } },
      orderBy: { purchaseDate: 'desc' },
    });
  }

  private readonly DEFAULT_ASSET_CATEGORIES: { name: string; icon: string; color: string }[] = [
    { name: 'Land', icon: 'mountain', color: 'green' },
    { name: 'Vehicle', icon: 'car', color: 'blue' },
    { name: 'Property', icon: 'building-2', color: 'orange' },
    { name: 'Jewellery', icon: 'gem', color: 'pink' },
    { name: 'Electronics', icon: 'laptop', color: 'purple' },
    { name: 'Investment', icon: 'trending-up', color: 'teal' },
    { name: 'Other', icon: 'package', color: 'indigo' },
  ];

  // Lazily seeds the 7 defaults (the design's order) the first time a business ever
  // looks at its category list -- same "lazy get-or-create" pattern as
  // AssetsService.requireOrCreateFixedAssetsAccount() -- so no migration
  // script is needed for already-existing businesses, and a fresh business
  // gets sensible defaults without a registration-time seed step.
  async listCategories(businessId: string) {
    const existing = await this.prisma.assetCategoryOption.findMany({ where: { businessId }, orderBy: { displayOrder: 'asc' } });
    if (existing.length > 0) return existing;
    await this.prisma.assetCategoryOption.createMany({
      data: this.DEFAULT_ASSET_CATEGORIES.map((c, i) => ({ businessId, name: c.name, icon: c.icon, color: c.color, displayOrder: i })),
    });
    return this.prisma.assetCategoryOption.findMany({ where: { businessId }, orderBy: { displayOrder: 'asc' } });
  }

  async createCategory(businessId: string, dto: CreateAssetCategoryDto) {
    const existing = await this.categoryNamed(businessId, dto.name);
    if (existing) {
      throw new ConflictException(`An asset category named "${dto.name}" already exists`);
    }
    const count = await this.prisma.assetCategoryOption.count({ where: { businessId } });
    return this.prisma.assetCategoryOption.create({
      data: { businessId, name: dto.name, icon: dto.icon, color: dto.color, displayOrder: count },
    });
  }

  async updateCategory(businessId: string, id: string, dto: UpdateAssetCategoryDto) {
    const category = await this.requireCategory(businessId, id);
    if (dto.name !== undefined) {
      const clash = await this.categoryNamed(businessId, dto.name);
      if (clash && clash.id !== id) {
        throw new ConflictException(`An asset category named "${dto.name}" already exists`);
      }
    }
    // The forms need something to offer: the last switched-on type stays on.
    if (dto.isActive === false && category.isActive) {
      const on = await this.prisma.assetCategoryOption.count({ where: { businessId, isActive: true } });
      if (on <= 1) {
        throw new BadRequestException('Keep at least one category on for the forms.');
      }
    }
    // An asset names its type by the type's name, so a rename takes the
    // type's assets along in the same commit; before, they kept the old
    // name and dropped out of the type.
    return this.prisma.$transaction(async (tx) => {
      if (dto.name !== undefined && dto.name !== category.name) {
        await tx.asset.updateMany({ where: { businessId, category: category.name }, data: { category: dto.name } });
      }
      return tx.assetCategoryOption.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.icon !== undefined && { icon: dto.icon }),
          ...(dto.color !== undefined && { color: dto.color }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        },
      });
    });
  }

  // The last type stays: an asset needs one to be filed under, and an empty
  // list is what brings the seven defaults back (listCategories()). A type
  // that still files assets (sold ones too: their history keeps it) stays
  // until they are moved; switching it off is how it leaves the forms.
  async deleteCategory(businessId: string, id: string) {
    const category = await this.requireCategory(businessId, id);
    if ((await this.prisma.assetCategoryOption.count({ where: { businessId } })) <= 1) {
      throw new BadRequestException('Keep at least one asset type.');
    }
    if ((await this.prisma.asset.count({ where: { businessId, category: category.name } })) > 0) {
      throw new ConflictException('This category still has assets. Move them to another category first.');
    }
    await this.prisma.assetCategoryOption.delete({ where: { id } });
    return { id };
  }

  // A category of this name, in any letter case: Shares and shares are one.
  private categoryNamed(businessId: string, name: string) {
    return this.prisma.assetCategoryOption.findFirst({ where: { businessId, name: { equals: name, mode: 'insensitive' } } });
  }

  private async requireCategory(businessId: string, id: string) {
    const category = await this.prisma.assetCategoryOption.findUnique({ where: { id } });
    if (!category || category.businessId !== businessId) {
      throw new NotFoundException('Asset category not found');
    }
    return category;
  }

  async purchase(businessId: string, dto: CreateAssetPurchaseDto, userId: string) {
    // An asset already owned is recorded at its value with no money moving:
    // no posting, purchaseAccountId/purchaseTransactionId stay null.
    if (!dto.purchaseAccountId) {
      return this.prisma.asset.create({
        data: {
          businessId,
          name: dto.name,
          category: dto.category,
          purchaseDate: new Date(dto.purchaseDate),
          purchasePrice: dto.purchasePrice,
          currentValue: dto.purchasePrice,
          notes: dto.notes || null,
          // recordedAt is the purchase day itself (not now), so a backdated
          // asset's first history row shows under the day it was got.
          valueHistory: { create: { value: dto.purchasePrice, note: OWNED_ROW_NOTE, recordedAt: new Date(dto.purchaseDate) } },
        },
        include: { valueHistory: { orderBy: VALUE_HISTORY_ORDER } },
      });
    }

    const purchaseAccountId = dto.purchaseAccountId;
    // One database transaction under the paying account's lock: the balance
    // check, the posting and the asset row commit together, and two
    // purchases from one account can't both pass the check on the same money.
    return this.transactionsService.withLocks([`account:${purchaseAccountId}`, `fixed-assets:${businessId}`], async (tx) => {
      const paymentAccount = await this.requirePaymentAccount(businessId, purchaseAccountId, tx);
      this.requireCanSpend(paymentAccount, new Prisma.Decimal(paymentAccount.currentBalance), dto.purchasePrice);
      const transaction = await this.postPurchase(tx, businessId, userId, {
        name: dto.name,
        notes: dto.notes,
        date: dto.purchaseDate,
        price: dto.purchasePrice,
        accountId: paymentAccount.id,
      });
      return tx.asset.create({
        data: {
          businessId,
          name: dto.name,
          category: dto.category,
          purchaseDate: new Date(dto.purchaseDate),
          purchasePrice: dto.purchasePrice,
          currentValue: dto.purchasePrice,
          purchaseAccountId: paymentAccount.id,
          purchaseTransactionId: transaction.id,
          notes: dto.notes || null,
          valueHistory: { create: { value: dto.purchasePrice, note: PAID_ROW_NOTE, recordedAt: new Date(dto.purchaseDate) } },
        },
        include: { valueHistory: { orderBy: VALUE_HISTORY_ORDER } },
      });
    });
  }

  // The purchase's posting: the price leaves the wallet into the pooled
  // fixed-assets account.
  private async postPurchase(
    tx: Prisma.TransactionClient,
    businessId: string,
    userId: string,
    purchase: { name: string; notes?: string | null; date: string; price: number | Prisma.Decimal; accountId: string },
  ) {
    const fixedAssetsAccount = await this.requireOrCreateFixedAssetsAccount(businessId, tx);
    const price = Number(purchase.price);
    return this.transactionsService.createTransaction(
      businessId,
      {
        transactionType: 'PURCHASE',
        transactionDate: purchase.date,
        description: purchase.notes ? `Asset purchase: ${purchase.name} -- ${purchase.notes}` : `Asset purchase: ${purchase.name}`,
        entries: [
          { accountId: fixedAssetsAccount.id, entryType: 'DEBIT', amount: price },
          { accountId: purchase.accountId, entryType: 'CREDIT', amount: price, note: purchase.notes ?? undefined },
        ],
      },
      userId,
      tx,
    );
  }

  // The sale's posting: the whole price counts as income ("Asset Sale" --
  // TransactionEntry.categoryId has no real FK, reports group by the string
  // and colour it themselves), into the wallet out of the pooled account.
  private async postSale(tx: Prisma.TransactionClient, businessId: string, userId: string, assetName: string, dto: SellAssetDto) {
    const fixedAssetsAccount = await this.requireOrCreateFixedAssetsAccount(businessId, tx);
    return this.transactionsService.createTransaction(
      businessId,
      {
        transactionType: 'INCOME',
        transactionDate: dto.date,
        description: dto.notes ? `Asset sale: ${assetName} -- ${dto.notes}` : `Asset sale: ${assetName}`,
        entries: [
          { accountId: dto.soldAccountId, entryType: 'DEBIT', amount: dto.soldPrice, categoryId: 'Asset Sale', note: dto.notes || undefined },
          { accountId: fixedAssetsAccount.id, entryType: 'CREDIT', amount: dto.soldPrice },
        ],
      },
      userId,
      tx,
    );
  }

  // A wallet may pay only what it holds. `before` is what it held before
  // this change (a correction may first give an old payment back), so a
  // change that leaves it no lower than before passes even on a wallet that
  // was already short.
  private requireCanSpend(wallet: Pick<Account, 'name' | 'currentBalance'>, before: Prisma.Decimal, amount: number | Prisma.Decimal) {
    const after = new Prisma.Decimal(wallet.currentBalance).minus(amount);
    if (after.isNegative() && after.lessThan(before)) {
      throw new BadRequestException(
        `"${wallet.name}" only has ${new Prisma.Decimal(wallet.currentBalance).toFixed(2)} -- cannot spend ${new Prisma.Decimal(amount).toFixed(2)} from it.`,
      );
    }
  }

  // Taking back money a sale paid into a wallet: the wallet must still hold
  // it (minus what the corrected sale pays in again), or it would go below
  // zero.
  private async requireCanTakeBack(walletId: string, amount: Prisma.Decimal, tx: Prisma.TransactionClient, label: string) {
    const wallet = await tx.account.findUnique({ where: { id: walletId }, select: { name: true, currentBalance: true } });
    if (!wallet || !amount.isPositive()) return;
    const balance = new Prisma.Decimal(wallet.currentBalance);
    if (balance.lessThan(amount)) {
      throw new BadRequestException(`"${wallet.name}" only has ${balance.toFixed(2)} -- ${label} ${amount.toFixed(2)} can't be taken back from it.`);
    }
  }

  // Runs under the asset's lock: a double click or a second tab waits for
  // the first sale to commit, then sees SOLD and stops -- one sale, one
  // income posting.
  async sell(businessId: string, id: string, dto: SellAssetDto, userId: string) {
    return this.transactionsService.withLocks([`asset:${id}`, `fixed-assets:${businessId}`], async (tx) => {
      const asset = await this.requireAsset(businessId, id, tx);
      if (asset.status === 'SOLD') {
        throw new BadRequestException('This asset has already been sold.');
      }
      if (isBeforePurchase(dto.date, asset.purchaseDate)) {
        throw new BadRequestException("An asset can't be sold before the day it was bought.");
      }
      const depositAccount = await this.requirePaymentAccount(businessId, dto.soldAccountId, tx);
      const transaction = await this.postSale(tx, businessId, userId, asset.name, { ...dto, soldAccountId: depositAccount.id });
      return tx.asset.update({
        where: { id },
        data: {
          status: 'SOLD',
          soldAt: new Date(dto.date),
          soldPrice: dto.soldPrice,
          soldAccountId: depositAccount.id,
          soldTransactionId: transaction.id,
          soldNote: dto.notes || null,
        },
        include: { valueHistory: { orderBy: VALUE_HISTORY_ORDER } },
      });
    });
  }

  // Sets right a sale recorded wrong (Purchase & Sell › Edit sale): its day,
  // price, wallet or note. The old sale's income is voided and the new one
  // posted in one commit; the wallet it paid into must still hold what is
  // taken back, as with undoing the sale.
  async editSale(businessId: string, id: string, dto: SellAssetDto, userId: string) {
    const before = await this.requireAsset(businessId, id);
    const lockKeys = [`asset:${id}`, `fixed-assets:${businessId}`, `account:${dto.soldAccountId}`];
    if (before.soldAccountId) lockKeys.push(`account:${before.soldAccountId}`);
    return this.transactionsService.withLocks([...new Set(lockKeys)], async (tx) => {
      const asset = await this.requireAsset(businessId, id, tx);
      if (asset.status !== 'SOLD') {
        throw new BadRequestException('This asset has not been sold.');
      }
      if (asset.soldAccountId !== before.soldAccountId) {
        throw new ConflictException('This sale changed meanwhile. Reload and try again.');
      }
      if (isBeforePurchase(dto.date, asset.purchaseDate)) {
        throw new BadRequestException("An asset can't be sold before the day it was bought.");
      }
      const depositAccount = await this.requirePaymentAccount(businessId, dto.soldAccountId, tx);
      const saleIsPosted = await this.isPosted(asset.soldTransactionId, tx);
      if (saleIsPosted && asset.soldAccountId && asset.soldPrice !== null) {
        // The same wallet gets the new price straight back.
        const back = new Prisma.Decimal(asset.soldPrice).minus(asset.soldAccountId === depositAccount.id ? dto.soldPrice : 0);
        await this.requireCanTakeBack(asset.soldAccountId, back, tx, "the sale's");
      }
      // Off the asset first, so the void isn't refused as an asset's posting.
      await tx.asset.update({ where: { id }, data: { soldTransactionId: null } });
      if (asset.soldTransactionId && saleIsPosted) {
        await this.transactionsService.voidTransaction(businessId, asset.soldTransactionId, `Sale corrected: ${asset.name}`, userId, tx);
      }
      const transaction = await this.postSale(tx, businessId, userId, asset.name, { ...dto, soldAccountId: depositAccount.id });
      return tx.asset.update({
        where: { id },
        data: {
          soldAt: new Date(dto.date),
          soldPrice: dto.soldPrice,
          soldAccountId: depositAccount.id,
          soldTransactionId: transaction.id,
          soldNote: dto.notes || null,
        },
        include: { valueHistory: { orderBy: VALUE_HISTORY_ORDER } },
      });
    });
  }

  // Plain data update, deliberately NOT a Transaction -- a market
  // revaluation (e.g. a car's book value falling, a plot's market rate
  // rising) isn't a real cash movement the user asked to model in the
  // ledger, just a log of "what I think this is worth now."
  async updateValue(businessId: string, id: string, dto: UpdateAssetValueDto) {
    const asset = await this.requireAsset(businessId, id);
    if (asset.status === 'SOLD') {
      throw new BadRequestException('Cannot update the value of a sold asset.');
    }
    if (isBeforePurchase(dto.date, asset.purchaseDate)) {
      throw new BadRequestException("A value can't be dated before the day the asset was bought.");
    }
    // A value for an earlier day fills in the history; only the newest one
    // is what the asset is worth today.
    const newest = await this.prisma.assetValueHistory.findFirst({ where: { assetId: id }, orderBy: VALUE_HISTORY_ORDER, select: { recordedAt: true } });
    const isToday = isNewestValuation(dto.date, newest?.recordedAt ?? null);
    return this.prisma.$transaction(async (tx) => {
      await tx.assetValueHistory.create({ data: { assetId: id, value: dto.value, note: dto.note, recordedAt: new Date(dto.date) } });
      return tx.asset.update({
        where: { id },
        data: isToday ? { currentValue: dto.value } : {},
        include: { valueHistory: { orderBy: VALUE_HISTORY_ORDER } },
      });
    });
  }

  // Sets right a value update recorded by mistake: its value, day or note.
  // The purchase's own row is where the asset starts (edit the purchase
  // instead), a sold asset's history is closed, and the asset's value today
  // follows whichever update is newest afterwards.
  async editValueUpdate(businessId: string, id: string, entryId: string, dto: UpdateAssetValueDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.requireValueUpdate(businessId, id, entryId, tx);
      const asset = await this.requireAsset(businessId, id, tx);
      if (isBeforePurchase(dto.date, asset.purchaseDate)) {
        throw new BadRequestException("A value can't be dated before the day the asset was bought.");
      }
      await tx.assetValueHistory.update({ where: { id: entryId }, data: { value: dto.value, note: dto.note ?? null, recordedAt: new Date(dto.date) } });
      return this.refreshCurrentValue(id, tx);
    });
  }

  // Removes a value update recorded by mistake, on the same terms.
  async deleteValueUpdate(businessId: string, id: string, entryId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.requireValueUpdate(businessId, id, entryId, tx);
      await tx.assetValueHistory.delete({ where: { id: entryId } });
      return this.refreshCurrentValue(id, tx);
    });
  }

  private async requireValueUpdate(businessId: string, id: string, entryId: string, tx: Prisma.TransactionClient) {
    const asset = await this.requireAsset(businessId, id, tx);
    if (asset.status === 'SOLD') {
      throw new BadRequestException("This asset is sold. Its value can't change.");
    }
    const rows = await tx.assetValueHistory.findMany({ where: { assetId: id }, select: { id: true, recordedAt: true, note: true } });
    if (!rows.some((row) => row.id === entryId)) {
      throw new NotFoundException('Value update not found');
    }
    if (purchaseRowOf(rows)?.id === entryId) {
      throw new BadRequestException('This is where the asset starts. Edit the purchase instead.');
    }
  }

  // The asset's value today is its newest update's.
  private async refreshCurrentValue(id: string, tx: Prisma.TransactionClient) {
    const newest = await tx.assetValueHistory.findFirst({ where: { assetId: id }, orderBy: VALUE_HISTORY_ORDER, select: { value: true } });
    return tx.asset.update({
      where: { id },
      data: newest ? { currentValue: newest.value } : {},
      include: { valueHistory: { orderBy: VALUE_HISTORY_ORDER } },
    });
  }

  // Corrects an asset (All Assets › Edit asset, Purchase & Sell › Edit
  // purchase): its name, category and note, and how it was got -- the
  // price, the day and the wallet that paid (none for an asset already
  // owned). A change to those voids the old purchase posting and posts the
  // new one in the same commit, under the locks of both wallets, and the
  // purchase's own history row follows. The day stays on or before every
  // value recorded since and the sale.
  async update(businessId: string, id: string, dto: UpdateAssetDto, userId: string) {
    const before = await this.requireAsset(businessId, id);
    const nextAccountId = dto.purchaseAccountId === undefined ? before.purchaseAccountId : dto.purchaseAccountId;
    const lockKeys = [`asset:${id}`, `fixed-assets:${businessId}`];
    if (before.purchaseAccountId) lockKeys.push(`account:${before.purchaseAccountId}`);
    if (nextAccountId) lockKeys.push(`account:${nextAccountId}`);
    return this.transactionsService.withLocks([...new Set(lockKeys)], async (tx) => {
      const asset = await this.requireAsset(businessId, id, tx);
      if (asset.purchaseAccountId !== before.purchaseAccountId) {
        throw new ConflictException('This asset changed meanwhile. Reload and try again.');
      }
      const name = dto.name ?? asset.name;
      const notes = dto.notes === undefined ? asset.notes : dto.notes?.trim() || null;
      const day = dto.purchaseDate === undefined ? dayOf(asset.purchaseDate) : dto.purchaseDate.slice(0, 10);
      const price = dto.purchasePrice === undefined ? new Prisma.Decimal(asset.purchasePrice) : new Prisma.Decimal(dto.purchasePrice);
      const moved = day !== dayOf(asset.purchaseDate);
      const repriced = !price.equals(asset.purchasePrice);
      const repaid = (nextAccountId ?? null) !== (asset.purchaseAccountId ?? null);

      const history = await tx.assetValueHistory.findMany({ where: { assetId: id }, select: { id: true, recordedAt: true, note: true } });
      const purchaseRow = purchaseRowOf(history);
      if (moved) {
        if (!canMovePurchaseTo(day, history, purchaseRow?.id)) {
          throw new BadRequestException("The purchase date can't be later than a value recorded for the asset.");
        }
        if (asset.soldAt && dayOf(asset.soldAt) < day) {
          throw new BadRequestException("The purchase date can't be after the sale date.");
        }
      }

      let purchaseTransactionId = asset.purchaseTransactionId;
      if (moved || repriced || repaid) {
        const wallet = nextAccountId ? await this.requirePaymentAccount(businessId, nextAccountId, tx) : null;
        const walletBefore = wallet ? new Prisma.Decimal(wallet.currentBalance) : null;
        if (asset.purchaseTransactionId) {
          const posted = await this.isPosted(asset.purchaseTransactionId, tx);
          // Off the asset first, so the void isn't refused as an asset's posting.
          await tx.asset.update({ where: { id }, data: { purchaseTransactionId: null } });
          if (posted) await this.transactionsService.voidTransaction(businessId, asset.purchaseTransactionId, `Purchase corrected: ${asset.name}`, userId, tx);
        }
        purchaseTransactionId = null;
        if (wallet && walletBefore) {
          // Read again: the void may just have given the old price back.
          const now = await this.requirePaymentAccount(businessId, wallet.id, tx);
          this.requireCanSpend(now, walletBefore, price);
          purchaseTransactionId = (await this.postPurchase(tx, businessId, userId, { name, notes, date: day, price, accountId: wallet.id })).id;
        }
      }

      const paid = !!nextAccountId;
      if (purchaseRow) {
        await tx.assetValueHistory.update({
          where: { id: purchaseRow.id },
          data: { value: price, recordedAt: new Date(day), note: paid ? PAID_ROW_NOTE : OWNED_ROW_NOTE },
        });
      } else {
        await tx.assetValueHistory.create({ data: { assetId: id, value: price, recordedAt: new Date(day), note: paid ? PAID_ROW_NOTE : OWNED_ROW_NOTE } });
      }
      await tx.asset.update({
        where: { id },
        data: {
          name,
          notes,
          ...(dto.category !== undefined && { category: dto.category }),
          purchaseDate: new Date(day),
          purchasePrice: price,
          purchaseAccountId: nextAccountId ?? null,
          purchaseTransactionId,
        },
      });
      return this.refreshCurrentValue(id, tx);
    });
  }

  // Takes away an asset entered by mistake, sold or not, and keeps it for a
  // few minutes so the delete can be undone (restore()). Its purchase and
  // its sale are voided in the same commit, so the money is as if neither
  // happened; the wallet a sale paid into must still hold the proceeds.
  async remove(businessId: string, id: string, userId: string) {
    const before = await this.requireAsset(businessId, id);
    const lockKeys = [`asset:${id}`, `fixed-assets:${businessId}`];
    if (before.soldAccountId) lockKeys.push(`account:${before.soldAccountId}`);
    return this.transactionsService.withLocks(lockKeys, async (tx) => {
      const asset = await this.requireAsset(businessId, id, tx);
      if (asset.soldAccountId !== before.soldAccountId) {
        throw new ConflictException('This asset changed meanwhile. Reload and try again.');
      }
      const purchaseIsPosted = await this.isPosted(asset.purchaseTransactionId, tx);
      const saleIsPosted = await this.isPosted(asset.soldTransactionId, tx);
      if (saleIsPosted && asset.soldAccountId && asset.soldPrice !== null) {
        await this.requireCanTakeBack(asset.soldAccountId, new Prisma.Decimal(asset.soldPrice), tx, "the sale's");
      }
      const history = await tx.assetValueHistory.findMany({ where: { assetId: id } });
      const snapshot: AssetSnapshot = {
        asset: {
          ...asset,
          purchaseDate: asset.purchaseDate.toISOString(),
          soldAt: asset.soldAt?.toISOString() ?? null,
          createdAt: asset.createdAt.toISOString(),
          purchasePrice: new Prisma.Decimal(asset.purchasePrice).toFixed(2),
          currentValue: new Prisma.Decimal(asset.currentValue).toFixed(2),
          soldPrice: asset.soldPrice === null ? null : new Prisma.Decimal(asset.soldPrice).toFixed(2),
          weightVori: asset.weightVori === null ? null : new Prisma.Decimal(asset.weightVori).toFixed(3),
        },
        history: history.map((row) => ({
          id: row.id,
          value: new Prisma.Decimal(row.value).toFixed(2),
          recordedAt: row.recordedAt.toISOString(),
          note: row.note,
        })),
      };
      await tx.assetValueHistory.deleteMany({ where: { assetId: id } });
      await tx.asset.delete({ where: { id } });
      // The asset is gone first, so the voids find no asset owning the
      // postings (voids of asset postings are refused anywhere else). A
      // posting voided before that rule existed has already given its money
      // back, so there is nothing left to void.
      if (asset.soldTransactionId && saleIsPosted) {
        await this.transactionsService.voidTransaction(businessId, asset.soldTransactionId, ASSET_DELETED_REASON, userId, tx);
      }
      if (asset.purchaseTransactionId && purchaseIsPosted) {
        await this.transactionsService.voidTransaction(businessId, asset.purchaseTransactionId, ASSET_DELETED_REASON, userId, tx);
      }
      await tx.assetDeletion.upsert({
        where: { assetId: id },
        create: { assetId: id, businessId, deletedBy: userId, snapshot: snapshot as unknown as Prisma.InputJsonValue },
        update: { businessId, deletedBy: userId, deletedAt: new Date(), snapshot: snapshot as unknown as Prisma.InputJsonValue },
      });
      return { id };
    });
  }

  // Undo of a delete: the asset and its value history come back as they
  // were, with their purchase and sale postings standing again (not posted
  // anew, so the wallets' statements read as before). Only by the person who
  // deleted it, within RESTORE_WINDOW_MINUTES; the purchase's wallet must
  // still hold the price.
  async restore(businessId: string, id: string, userId: string, now = new Date()) {
    const deletion = await this.prisma.assetDeletion.findUnique({ where: { assetId: id } });
    if (!deletion || deletion.businessId !== businessId) {
      throw new NotFoundException('This delete can no longer be undone.');
    }
    if (deletion.deletedBy !== userId) {
      throw new ForbiddenException('Only the person who deleted it can undo the delete');
    }
    if (now.getTime() - deletion.deletedAt.getTime() > RESTORE_WINDOW_MINUTES * 60_000) {
      throw new BadRequestException('A delete can be undone for 10 minutes only');
    }
    const { asset, history } = deletion.snapshot as unknown as AssetSnapshot;
    const lockKeys = [`asset:${id}`, `fixed-assets:${businessId}`];
    if (asset.purchaseAccountId) lockKeys.push(`account:${asset.purchaseAccountId}`);
    if (asset.soldAccountId) lockKeys.push(`account:${asset.soldAccountId}`);
    return this.transactionsService.withLocks([...new Set(lockKeys)], async (tx) => {
      // Claimed with a condition: of two undos racing, only one gets here.
      const claimed = await tx.assetDeletion.deleteMany({ where: { assetId: id, businessId } });
      if (claimed.count === 0) {
        throw new BadRequestException('This asset is back already');
      }
      if (asset.soldTransactionId) {
        await this.transactionsService.reinstateVoided(tx, businessId, asset.soldTransactionId, ASSET_DELETED_REASON);
      }
      if (asset.purchaseTransactionId && asset.purchaseAccountId) {
        const wallet = await tx.account.findUnique({ where: { id: asset.purchaseAccountId }, select: { name: true, currentBalance: true } });
        const posting = await tx.transaction.findUnique({ where: { id: asset.purchaseTransactionId }, select: { status: true, voidedReason: true } });
        if (wallet && posting?.status === 'VOIDED' && posting.voidedReason === ASSET_DELETED_REASON) {
          this.requireCanSpend(wallet, new Prisma.Decimal(wallet.currentBalance), new Prisma.Decimal(asset.purchasePrice));
        }
        await this.transactionsService.reinstateVoided(tx, businessId, asset.purchaseTransactionId, ASSET_DELETED_REASON);
      }
      await tx.asset.create({
        data: {
          ...asset,
          purchaseDate: new Date(asset.purchaseDate),
          soldAt: asset.soldAt ? new Date(asset.soldAt) : null,
          createdAt: new Date(asset.createdAt),
        },
      });
      await tx.assetValueHistory.createMany({
        data: history.map((row) => ({ id: row.id, assetId: id, value: row.value, recordedAt: new Date(row.recordedAt), note: row.note })),
      });
      return tx.asset.findUniqueOrThrow({ where: { id }, include: { valueHistory: { orderBy: VALUE_HISTORY_ORDER } } });
    });
  }

  // Deletes past the undo window are final: their snapshots go.
  async purgeDeletions(now: Date) {
    const { count } = await this.prisma.assetDeletion.deleteMany({ where: { deletedAt: { lt: new Date(now.getTime() - RESTORE_WINDOW_MINUTES * 60_000) } } });
    return count;
  }

  // Undoes a sale recorded by mistake: the sale's income is voided and the
  // asset is owned again, at the value it had before. The wallet the sale
  // paid into is locked and checked like a purchase's: the proceeds must
  // still be there to take back, or the wallet would go below zero.
  async undoSale(businessId: string, id: string, userId: string) {
    // Read first to learn which wallet to lock. Locks are taken in sorted
    // order (withLocks), so the wallet lock has to be among the keys from
    // the start; locking it later would deadlock against purchase().
    const before = await this.requireAsset(businessId, id);
    const lockKeys = [`asset:${id}`, `fixed-assets:${businessId}`];
    if (before.soldAccountId) lockKeys.push(`account:${before.soldAccountId}`);
    return this.transactionsService.withLocks(lockKeys, async (tx) => {
      const asset = await this.requireAsset(businessId, id, tx);
      if (asset.status !== 'SOLD') {
        throw new BadRequestException('This asset has not been sold.');
      }
      // Undone and sold again into another wallet while this call waited:
      // the wallet locked above is the wrong one.
      if (asset.soldAccountId !== before.soldAccountId) {
        throw new ConflictException('This sale changed meanwhile. Reload and try again.');
      }
      // A sale posting voided before that was refused has no money left in
      // the wallet to take back; the asset is simply owned again.
      const saleIsPosted = await this.isPosted(asset.soldTransactionId, tx);
      if (saleIsPosted && asset.soldAccountId && asset.soldPrice !== null) {
        await this.requireCanTakeBack(asset.soldAccountId, new Prisma.Decimal(asset.soldPrice), tx, "the sale's");
      }
      const restored = await tx.asset.update({
        where: { id },
        data: { status: 'ACTIVE', soldAt: null, soldPrice: null, soldAccountId: null, soldTransactionId: null, soldNote: null },
        include: { valueHistory: { orderBy: VALUE_HISTORY_ORDER } },
      });
      if (asset.soldTransactionId && saleIsPosted) {
        await this.transactionsService.voidTransaction(businessId, asset.soldTransactionId, `Sale undone: ${asset.name}`, userId, tx);
      }
      return restored;
    });
  }

  // Whether an asset's posting still holds its money. Postings voided
  // before feature-owned postings were protected stay VOIDED, and voiding
  // them again would be refused.
  private async isPosted(transactionId: string | null, tx: Prisma.TransactionClient): Promise<boolean> {
    if (!transactionId) return false;
    const posting = await tx.transaction.findUnique({ where: { id: transactionId }, select: { status: true } });
    return posting?.status === 'POSTED';
  }

  private async requireAsset(businessId: string, id: string, client: Prisma.TransactionClient = this.prisma): Promise<Asset> {
    const asset = await client.asset.findUnique({ where: { id } });
    if (!asset || asset.businessId !== businessId) {
      throw new NotFoundException('Asset not found');
    }
    return asset;
  }

  // Accepts EITHER a regular money account (cash/bank/mfs) OR a Savings
  // Wallet -- matches the product spec's "General Account or Savings
  // Account" dropdown.
  private async requirePaymentAccount(businessId: string, accountId: string, client: Prisma.TransactionClient = this.prisma): Promise<Account> {
    const account = await client.account.findUnique({ where: { id: accountId } });
    if (!account || account.businessId !== businessId) {
      throw new BadRequestException('Account not found in this workspace');
    }
    const isMoneyAccount = account.accountType === 'ASSET' && !!account.accountSubtype && MONEY_ACCOUNT_SUBTYPES.includes(account.accountSubtype);
    const isSavingsWallet = account.accountType === 'ASSET' && account.accountSubtype === 'savings' && !account.isSystemAccount;
    if (!isMoneyAccount && !isSavingsWallet) {
      throw new BadRequestException('Must be a General (cash/bank/mobile money) or Savings account');
    }
    return account;
  }

  // Hidden pooled system Account backing every asset purchase/sale's double
  // entry -- same "lightweight ledger over a real Account" architecture as
  // SavingsGoal's own pooled Savings account. accountSubtype 'fixed-assets'
  // is deliberately outside MONEY_ACCOUNT_SUBTYPES and not 'savings' either,
  // so it's automatically excluded from every existing money-account/
  // savings-wallet listing and total (Balance, Savings Goals) with no
  // special-casing needed -- never shown or pickable directly by a user.
  // Callers hold the `fixed-assets:<businessId>` lock, so two first-ever
  // purchases can't each create one.
  private async requireOrCreateFixedAssetsAccount(businessId: string, client: Prisma.TransactionClient = this.prisma): Promise<Account> {
    const existing = await client.account.findFirst({
      where: { businessId, accountSubtype: FIXED_ASSETS_ACCOUNT_SUBTYPE, isSystemAccount: true },
    });
    if (existing) return existing;
    return client.account.create({
      data: {
        businessId,
        name: 'Fixed Assets (Internal)',
        accountType: 'ASSET',
        accountSubtype: FIXED_ASSETS_ACCOUNT_SUBTYPE,
        isSystemAccount: true,
        openingBalance: 0,
        currentBalance: 0,
      },
    });
  }
}
