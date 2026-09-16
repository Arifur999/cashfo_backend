import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Account, Asset, Prisma } from '@prisma/client';
import { MONEY_ACCOUNT_SUBTYPES } from '../accounts/accounts.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TransactionsService } from '../transactions/transactions.service.js';
import { CreateAssetCategoryDto } from './dto/create-asset-category.dto.js';
import { CreateAssetPurchaseDto } from './dto/create-asset-purchase.dto.js';
import { SellAssetDto } from './dto/sell-asset.dto.js';
import { UpdateAssetCategoryDto } from './dto/update-asset-category.dto.js';
import { UpdateAssetValueDto } from './dto/update-asset-value.dto.js';

const FIXED_ASSETS_ACCOUNT_SUBTYPE = 'fixed-assets';
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
    await this.requireCategory(businessId, id);
    if (dto.name !== undefined) {
      const clash = await this.prisma.assetCategoryOption.findUnique({ where: { businessId_name: { businessId, name: dto.name } } });
      if (clash && clash.id !== id) {
        throw new ConflictException(`An asset category named "${dto.name}" already exists`);
      }
    }
    return this.prisma.assetCategoryOption.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.icon !== undefined && { icon: dto.icon }),
        ...(dto.color !== undefined && { color: dto.color }),
      },
    });
  }

  async deleteCategory(businessId: string, id: string) {
    await this.requireCategory(businessId, id);
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

    const paymentAccount = await this.requirePaymentAccount(businessId, dto.purchaseAccountId);
    if (new Prisma.Decimal(paymentAccount.currentBalance).lessThan(dto.purchasePrice)) {
      throw new BadRequestException(
        `"${paymentAccount.name}" only has ${new Prisma.Decimal(paymentAccount.currentBalance).toFixed(2)} -- cannot spend ${dto.purchasePrice.toFixed(2)} from it.`,
      );
    }
    const fixedAssetsAccount = await this.requireOrCreateFixedAssetsAccount(businessId);

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
    );

    return this.prisma.asset.create({
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
  }

  // Entire sale proceeds count as Income (per explicit product spec), tagged
  // with a fixed categoryId string "Asset Sale" -- TransactionEntry.categoryId
  // has no real FK (see its own schema comment), ReportsService.getCategoryBreakdown()
  // groups by this string directly and falls back to a generated color when no
  // BudgetCategory of that name exists, so this needs no BudgetCategory row at all.
  async sell(businessId: string, id: string, dto: SellAssetDto, userId: string) {
    const asset = await this.requireAsset(businessId, id);
    if (asset.status === 'SOLD') {
      throw new BadRequestException('This asset has already been sold.');
    }
    const depositAccount = await this.requirePaymentAccount(businessId, dto.soldAccountId);
    const fixedAssetsAccount = await this.requireOrCreateFixedAssetsAccount(businessId);

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
    );

    return this.prisma.asset.update({
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
    await this.prisma.assetValueHistory.create({ data: { assetId: id, value: dto.value, note: dto.note, recordedAt: new Date(dto.date) } });
    return this.prisma.asset.update({
      where: { id },
      data: { currentValue: dto.value },
      include: { valueHistory: { orderBy: VALUE_HISTORY_ORDER } },
    });
  }

  private async requireAsset(businessId: string, id: string): Promise<Asset> {
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset || asset.businessId !== businessId) {
      throw new NotFoundException('Asset not found');
    }
    return asset;
  }

  // Accepts EITHER a regular money account (cash/bank/mfs) OR a Savings
  // Wallet -- matches the product spec's "General Account or Savings
  // Account" dropdown.
  private async requirePaymentAccount(businessId: string, accountId: string): Promise<Account> {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
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
  private async requireOrCreateFixedAssetsAccount(businessId: string): Promise<Account> {
    const existing = await this.prisma.account.findFirst({
      where: { businessId, accountSubtype: FIXED_ASSETS_ACCOUNT_SUBTYPE, isSystemAccount: true },
    });
    if (existing) return existing;
    return this.prisma.account.create({
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
