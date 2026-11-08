import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Account, Asset, Prisma } from '@prisma/client';
import { FIXED_ASSETS_ACCOUNT_SUBTYPE, MONEY_ACCOUNT_SUBTYPES } from '../accounts/accounts.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TransactionsService } from '../transactions/transactions.service.js';
import { canMovePurchaseTo, isBeforePurchase, isNewestValuation, purchaseRowOf } from './asset-dates.js';
import { CreateAssetCategoryDto } from './dto/create-asset-category.dto.js';
import { CreateAssetPurchaseDto } from './dto/create-asset-purchase.dto.js';
import { SellAssetDto } from './dto/sell-asset.dto.js';
import { UpdateAssetCategoryDto } from './dto/update-asset-category.dto.js';
import { UpdateAssetValueDto } from './dto/update-asset-value.dto.js';
import { UpdateAssetDto } from './dto/update-asset.dto.js';

const VALUE_HISTORY_ORDER = { recordedAt: 'desc' as const };

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
    { name: 'Vehicle', icon: 'car', color: 'blue' },
    { name: 'Land', icon: 'mountain', color: 'green' },
    { name: 'Property', icon: 'building-2', color: 'orange' },
    { name: 'Jewellery', icon: 'gem', color: 'pink' },
    { name: 'Electronics', icon: 'laptop', color: 'purple' },
    { name: 'Investment', icon: 'trending-up', color: 'teal' },
    { name: 'Other', icon: 'package', color: 'indigo' },
  ];

  // Lazily seeds the 7 original defaults the first time a business ever
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
    const existing = await this.prisma.assetCategoryOption.findUnique({ where: { businessId_name: { businessId, name: dto.name } } });
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
      const clash = await this.prisma.assetCategoryOption.findUnique({ where: { businessId_name: { businessId, name: dto.name } } });
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

  private async requireCategory(businessId: string, id: string) {
    const category = await this.prisma.assetCategoryOption.findUnique({ where: { id } });
    if (!category || category.businessId !== businessId) {
      throw new NotFoundException('Asset category not found');
    }
    return category;
  }

  async purchase(businessId: string, dto: CreateAssetPurchaseDto, userId: string) {
    // "Current Asset list"'s simpler Add Assets flow has no Account field
    // at all -- it's a plain inventory entry (Date/Asset Name/Category/
    // Value/Notes only), deliberately NOT tied to any real money movement.
    // Skip the Transaction entirely in that case; purchaseAccountId/
    // purchaseTransactionId stay null. "Purchase & Sell Asset"'s own
    // Purchase Asset form still always sends a real purchaseAccountId, so it
    // always takes the real-transaction branch below.
    if (!dto.purchaseAccountId) {
      return this.prisma.asset.create({
        data: {
          businessId,
          name: dto.name,
          category: dto.category,
          purchaseDate: new Date(dto.purchaseDate),
          purchasePrice: dto.purchasePrice,
          currentValue: dto.purchasePrice,
          notes: dto.notes,
          // recordedAt explicitly set to the purchase date itself (not left
          // at its @default(now())) -- otherwise a backdated purchase would
          // show its first "View Details" history row under today's date
          // instead of when it was actually bought.
          valueHistory: { create: { value: dto.purchasePrice, note: 'Initial value', recordedAt: new Date(dto.purchaseDate) } },
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
      if (new Prisma.Decimal(paymentAccount.currentBalance).lessThan(dto.purchasePrice)) {
        throw new BadRequestException(
          `"${paymentAccount.name}" only has ${new Prisma.Decimal(paymentAccount.currentBalance).toFixed(2)} -- cannot spend ${dto.purchasePrice.toFixed(2)} from it.`,
        );
      }
      const fixedAssetsAccount = await this.requireOrCreateFixedAssetsAccount(businessId, tx);

      const transaction = await this.transactionsService.createTransaction(
        businessId,
        {
          transactionType: 'PURCHASE',
          transactionDate: dto.purchaseDate,
          description: dto.notes ? `Asset purchase: ${dto.name} -- ${dto.notes}` : `Asset purchase: ${dto.name}`,
          entries: [
            { accountId: fixedAssetsAccount.id, entryType: 'DEBIT', amount: dto.purchasePrice },
            { accountId: paymentAccount.id, entryType: 'CREDIT', amount: dto.purchasePrice, note: dto.notes },
          ],
        },
        userId,
        tx,
      );

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
          notes: dto.notes,
          valueHistory: { create: { value: dto.purchasePrice, note: 'Initial purchase value', recordedAt: new Date(dto.purchaseDate) } },
        },
        include: { valueHistory: { orderBy: VALUE_HISTORY_ORDER } },
      });
    });
  }

  // Entire sale proceeds count as Income (per explicit product spec), tagged
  // with a fixed categoryId string "Asset Sale" -- TransactionEntry.categoryId
  // has no real FK (see its own schema comment), ReportsService.getCategoryBreakdown()
  // groups by this string directly and falls back to a generated color when no
  // BudgetCategory of that name exists, so this needs no BudgetCategory row at all.
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
      const fixedAssetsAccount = await this.requireOrCreateFixedAssetsAccount(businessId, tx);

      const transaction = await this.transactionsService.createTransaction(
        businessId,
        {
          transactionType: 'INCOME',
          transactionDate: dto.date,
          description: dto.notes ? `Asset sale: ${asset.name} -- ${dto.notes}` : `Asset sale: ${asset.name}`,
          entries: [
            { accountId: depositAccount.id, entryType: 'DEBIT', amount: dto.soldPrice, categoryId: 'Asset Sale', note: dto.notes },
            { accountId: fixedAssetsAccount.id, entryType: 'CREDIT', amount: dto.soldPrice },
          ],
        },
        userId,
        tx,
      );

      return tx.asset.update({
        where: { id },
        data: {
          status: 'SOLD',
          soldAt: new Date(dto.date),
          soldPrice: dto.soldPrice,
          soldAccountId: depositAccount.id,
          soldTransactionId: transaction.id,
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

  // Corrects an asset's name, type and notes. The purchase date changes
  // only on an owned asset no wallet paid for (a paid purchase keeps its
  // posting's date, and a sale stays after its purchase), and never past a
  // value recorded since. Only the purchase's own history row moves with
  // it: an asset added as already owned gets a value check dated the day it
  // was added, and that check stays where it is.
  async update(businessId: string, id: string, dto: UpdateAssetDto) {
    const asset = await this.requireAsset(businessId, id);
    const newDate =
      dto.purchaseDate !== undefined && dto.purchaseDate.slice(0, 10) !== asset.purchaseDate.toISOString().slice(0, 10) ? new Date(dto.purchaseDate) : null;
    let purchaseRowId: string | undefined;
    if (newDate) {
      if (asset.purchaseTransactionId) {
        throw new BadRequestException('A purchase paid from a wallet keeps its date. Delete the asset and add it again to change it.');
      }
      if (asset.status === 'SOLD') {
        throw new BadRequestException('A sold asset keeps its purchase date. Undo the sale to change it.');
      }
      const history = await this.prisma.assetValueHistory.findMany({ where: { assetId: id }, select: { id: true, recordedAt: true, note: true } });
      purchaseRowId = purchaseRowOf(history)?.id;
      if (!canMovePurchaseTo(newDate, history, purchaseRowId)) {
        throw new BadRequestException("The purchase date can't be later than a value recorded for the asset.");
      }
    }
    return this.prisma.$transaction(async (tx) => {
      if (newDate && purchaseRowId) await tx.assetValueHistory.update({ where: { id: purchaseRowId }, data: { recordedAt: newDate } });
      return tx.asset.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.category !== undefined && { category: dto.category }),
          ...(dto.notes !== undefined && { notes: dto.notes?.trim() || null }),
          ...(newDate && { purchaseDate: newDate }),
        },
        include: { valueHistory: { orderBy: VALUE_HISTORY_ORDER } },
      });
    });
  }

  // Takes away an asset entered by mistake. A purchase paid from a wallet is
  // voided in the same commit, so the money is back in the wallet; a sold
  // asset needs its sale undone first.
  async remove(businessId: string, id: string, userId: string) {
    return this.transactionsService.withLocks([`asset:${id}`, `fixed-assets:${businessId}`], async (tx) => {
      const asset = await this.requireAsset(businessId, id, tx);
      if (asset.status === 'SOLD') {
        throw new BadRequestException('Undo the sale first, then delete the asset.');
      }
      const purchaseIsPosted = await this.isPosted(asset.purchaseTransactionId, tx);
      await tx.assetValueHistory.deleteMany({ where: { assetId: id } });
      await tx.asset.delete({ where: { id } });
      // The asset is gone first, so the void finds no asset owning the
      // posting (voids of asset postings are refused anywhere else). A
      // purchase voided before that rule existed has already given its
      // money back, so there is nothing left to void.
      if (asset.purchaseTransactionId && purchaseIsPosted) {
        await this.transactionsService.voidTransaction(businessId, asset.purchaseTransactionId, `Asset deleted: ${asset.name}`, userId, tx);
      }
      return { id };
    });
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
        const wallet = await tx.account.findUnique({ where: { id: asset.soldAccountId }, select: { name: true, currentBalance: true } });
        const balance = new Prisma.Decimal(wallet?.currentBalance ?? 0);
        if (wallet && balance.lessThan(asset.soldPrice)) {
          throw new BadRequestException(
            `"${wallet.name}" only has ${balance.toFixed(2)} -- the sale's ${new Prisma.Decimal(asset.soldPrice).toFixed(2)} can't be taken back from it.`,
          );
        }
      }
      const restored = await tx.asset.update({
        where: { id },
        data: { status: 'ACTIVE', soldAt: null, soldPrice: null, soldAccountId: null, soldTransactionId: null },
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
