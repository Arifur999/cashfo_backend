import { Injectable } from '@nestjs/common';
import { BudgetCategoryType } from '@prisma/client';
import { MONEY_ACCOUNT_SUBTYPES } from '../accounts/accounts.service.js';
import { ensureCategory } from '../budgets/budgets.service.js';
import { dhakaDateKey } from '../common/dhaka.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TransactionsService } from '../transactions/transactions.service.js';
import { ImportRowDto, ImportTransactionsDto } from './dto/import-transactions.dto.js';

const same = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

// Settings › Data & privacy › Import: income and expenses from a file the
// person has matched to Smartly's fields, each posted the way Income &
// Expense posts one, marked with the file it came from. A row is posted
// once per file (its key), so importing the same file again, or a retried
// request, adds nothing twice.
@Injectable()
export class ImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionsService,
  ) {}

  // What the page matches rows against before sending them.
  async context(businessId: string) {
    const [wallets, categories, imported] = await Promise.all([
      this.wallets(businessId),
      this.prisma.budgetCategory.findMany({ where: { businessId }, orderBy: [{ type: 'asc' }, { displayOrder: 'asc' }], select: { type: true, name: true } }),
      this.prisma.transaction.count({ where: { businessId, importedFrom: { not: null }, reversalOfId: null } }),
    ]);
    return {
      wallets: wallets.map((wallet) => wallet.name),
      categories: {
        income: categories.filter((row) => row.type === BudgetCategoryType.INCOME).map((row) => row.name),
        expense: categories.filter((row) => row.type === BudgetCategoryType.EXPENSE).map((row) => row.name),
      },
      imported,
    };
  }

  async importRows(businessId: string, dto: ImportTransactionsDto, userId: string) {
    const [wallets, accounts, categories] = await Promise.all([
      this.wallets(businessId),
      this.prisma.account.findMany({
        where: { businessId, status: 'ACTIVE', accountType: { in: ['INCOME', 'EXPENSE'] } },
        orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.budgetCategory.findMany({ where: { businessId }, select: { type: true, name: true } }),
    ]);
    const today = dhakaDateKey(new Date());
    const keyOf = (row: ImportRowDto) => `import:${businessId}:${dto.fileKey}:${row.row}`;
    const done = new Set(
      (await this.prisma.transaction.findMany({ where: { idempotencyKey: { in: dto.rows.map(keyOf) } }, select: { idempotencyKey: true } })).map(
        (row) => row.idempotencyKey,
      ),
    );

    let added = 0;
    let already = 0;
    // The reason is the page's own words (a dictionary key), {value} filled from value.
    const skipped: { row: number; reason: string; value?: string }[] = [];
    for (const row of dto.rows) {
      if (done.has(keyOf(row))) {
        already++;
        continue;
      }
      if (row.date > today) {
        skipped.push({ row: row.row, reason: 'The date is in the future.' });
        continue;
      }
      if (!(row.amount > 0)) {
        skipped.push({ row: row.row, reason: '“{value}” is not an amount.', value: String(row.amount) });
        continue;
      }
      const wallet = row.wallet ? wallets.find((one) => same(one.name, row.wallet!)) : wallets[0];
      if (!wallet) {
        skipped.push(row.wallet ? { row: row.row, reason: 'No wallet named “{value}”.', value: row.wallet } : { row: row.row, reason: 'Add a wallet first.' });
        continue;
      }
      // An existing category in its own spelling, or a new one.
      const category = row.category ? (categories.find((one) => one.type === row.type && same(one.name, row.category!))?.name ?? row.category) : undefined;
      // As Income & Expense picks it: the income account, or the expense
      // account named like the category, else the first.
      const kind = accounts.filter((account) => account.accountType === row.type);
      const booked = (category && kind.find((account) => account.name.toLocaleLowerCase().includes(category.toLocaleLowerCase()))) || kind[0];
      if (!booked) {
        skipped.push({ row: row.row, reason: row.type === 'INCOME' ? 'This workspace has no income account.' : 'This workspace has no expense account.' });
        continue;
      }
      const note = row.note?.trim() || undefined;
      await this.prisma.$transaction(async (tx) => {
        if (category) {
          await ensureCategory(tx, businessId, row.type, category, null);
          if (!categories.some((one) => one.type === row.type && one.name === category)) categories.push({ type: row.type, name: category });
        }
        const posted = await this.transactions.createTransaction(
          businessId,
          {
            transactionType: row.type,
            transactionDate: row.date,
            idempotencyKey: keyOf(row),
            entries:
              row.type === 'INCOME'
                ? [
                    { accountId: wallet.id, entryType: 'DEBIT', amount: row.amount },
                    { accountId: booked.id, entryType: 'CREDIT', amount: row.amount, categoryId: category, note },
                  ]
                : [
                    { accountId: booked.id, entryType: 'DEBIT', amount: row.amount, categoryId: category, note },
                    { accountId: wallet.id, entryType: 'CREDIT', amount: row.amount },
                  ],
          },
          userId,
          tx,
        );
        await tx.transaction.update({ where: { id: posted.id }, data: { importedFrom: dto.fileName } });
      });
      added++;
    }
    return { added, already, skipped };
  }

  private wallets(businessId: string) {
    return this.prisma.account.findMany({
      where: { businessId, status: 'ACTIVE', accountType: 'ASSET', accountSubtype: { in: MONEY_ACCOUNT_SUBTYPES } },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, name: true },
    });
  }
}
