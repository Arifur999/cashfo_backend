import { Injectable } from '@nestjs/common';
import type { Business } from '@prisma/client';
import { dhakaDateKey } from '../common/dhaka.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { day, toCsv } from './csv.js';
import { zipFiles, type ZipEntry } from './zip.js';

// A folder name a zip tool and every OS accept: no control characters, and
// none of the ones Windows refuses.
const folderName = (name: string) =>
  [...name]
    .filter((ch) => ch.charCodeAt(0) >= 32)
    .join('')
    .replace(/[\\/:*?"<>|]/g, '-')
    .trim()
    .slice(0, 60) || 'Workspace';

// Settings > Resources > Download my data: the customer's profile and every
// workspace they own, as spreadsheets in one .zip, a folder per workspace.
// Saved passwords (the vault) are left out on purpose.
@Injectable()
export class AccountExportService {
  constructor(private readonly prisma: PrismaService) {}

  async export(userId: string): Promise<{ fileName: string; data: Buffer }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { name: true, email: true, phone: true, preferredLanguage: true, createdAt: true, ownedBusinesses: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } } },
    });

    const files: ZipEntry[] = [{ name: 'profile.csv', data: toCsv(['Name', 'Email', 'Phone', 'Language', 'Joined'], [[user.name, user.email, user.phone, user.preferredLanguage, user.createdAt]]) }];
    const used = new Set<string>();
    for (const workspace of user.ownedBusinesses) {
      // Two workspaces with one name get their own folders.
      let folder = folderName(workspace.isDefault ? 'Personal' : workspace.name);
      for (let n = 2; used.has(folder); n++) folder = `${folderName(workspace.name)} (${n})`;
      used.add(folder);
      const sheets = workspace.type === 'GROUP' ? await this.groupSheets(workspace) : await this.workspaceSheets(workspace);
      files.push(...sheets.map((sheet) => ({ name: `${folder}/${sheet.name}`, data: sheet.data })));
    }
    return { fileName: `smartly-data-${dhakaDateKey(new Date())}.zip`, data: zipFiles(files) };
  }

  // A personal or business workspace: wallets, transactions, budgets,
  // savings, assets and the people and banks behind loans.
  private async workspaceSheets(workspace: Business): Promise<ZipEntry[]> {
    const businessId = workspace.id;
    const [accounts, transactions, budgets, goals, entries, assets, contacts] = await Promise.all([
      this.prisma.account.findMany({ where: { businessId }, orderBy: [{ accountType: 'asc' }, { displayOrder: 'asc' }, { name: 'asc' }] }),
      this.prisma.transaction.findMany({
        where: { businessId },
        orderBy: [{ transactionDate: 'asc' }, { createdAt: 'asc' }],
        include: { contact: { select: { name: true } }, entries: { include: { account: { select: { name: true } } } } },
      }),
      this.prisma.budgetCategory.findMany({ where: { businessId }, orderBy: [{ type: 'asc' }, { displayOrder: 'asc' }] }),
      this.prisma.savingsGoal.findMany({ where: { businessId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.savingsGoalEntry.findMany({ where: { businessId }, orderBy: { date: 'asc' }, include: { savingsGoal: { select: { name: true } } } }),
      this.prisma.asset.findMany({ where: { businessId }, orderBy: { purchaseDate: 'asc' } }),
      this.prisma.contact.findMany({ where: { businessId }, orderBy: { name: 'asc' } }),
    ]);

    return [
      {
        name: 'wallets-and-accounts.csv',
        data: toCsv(
          ['Name', 'Type', 'Kind', 'Account number', 'Opening balance', 'Current balance', 'Status'],
          accounts.map((a) => [a.name, a.accountType, a.accountSubtype, a.accountNumber, a.openingBalance, a.currentBalance, a.status]),
        ),
      },
      {
        name: 'transactions.csv',
        data: toCsv(
          ['Date', 'Type', 'Description', 'Amount', 'From', 'To', 'Category', 'Contact', 'Reference', 'Due date', 'Status', 'Void reason', 'Recorded at'],
          transactions.map((t) => {
            const debits = t.entries.filter((e) => e.entryType === 'DEBIT');
            const credits = t.entries.filter((e) => e.entryType === 'CREDIT');
            const amount = debits.reduce((sum, e) => sum + Number(e.amount), 0);
            const categories = [...new Set(t.entries.map((e) => e.categoryId).filter(Boolean))].join('; ');
            return [day(t.transactionDate), t.transactionType, t.description, amount.toFixed(2), credits.map((e) => e.account.name).join('; '), debits.map((e) => e.account.name).join('; '), categories, t.contact?.name, t.referenceNo, day(t.dueDate), t.reversalOfId ? 'REVERSAL' : t.status, t.voidedReason, t.createdAt];
          }),
        ),
      },
      { name: 'budget-categories.csv', data: toCsv(['Type', 'Name', 'Monthly limit'], budgets.map((b) => [b.type, b.name, b.monthlyLimit])) },
      {
        name: 'savings-goals.csv',
        data: toCsv(['Name', 'Target amount', 'Target date', 'Months', 'Status', 'Description', 'Created'], goals.map((g) => [g.name, g.targetAmount, day(g.targetDate), g.durationMonths, g.status, g.description, g.createdAt])),
      },
      { name: 'savings-entries.csv', data: toCsv(['Date', 'Goal', 'Type', 'Amount', 'Notes'], entries.map((e) => [day(e.date), e.savingsGoal.name, e.type, e.amount, e.notes])) },
      {
        name: 'assets.csv',
        data: toCsv(
          ['Name', 'Category', 'Bought on', 'Price', 'Current value', 'Status', 'Sold on', 'Sold for', 'Notes'],
          assets.map((a) => [a.name, a.category, day(a.purchaseDate), a.purchasePrice, a.currentValue, a.status, day(a.soldAt), a.soldPrice, a.notes]),
        ),
      },
      {
        name: 'contacts-and-loans.csv',
        data: toCsv(
          ['Name', 'Type', 'Kept under', 'Phone', 'Email', 'Address', 'Opening balance', 'Status', 'Notes'],
          contacts.map((c) => [c.name, c.type, c.category === 'LOAN' ? 'Loans' : 'Dena-Pawna', c.phone, c.email, c.address, c.openingBalance, c.status, c.notes]),
        ),
      },
    ];
  }

  // A group: its members, money in, costs and meals.
  private async groupSheets(workspace: Business): Promise<ZipEntry[]> {
    const businessId = workspace.id;
    const [members, contributions, expenses, meals] = await Promise.all([
      this.prisma.groupMember.findMany({ where: { businessId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.groupContribution.findMany({ where: { businessId }, orderBy: { date: 'asc' }, include: { groupMember: { select: { name: true } } } }),
      this.prisma.groupExpense.findMany({ where: { businessId }, orderBy: { date: 'asc' }, include: { paidByMember: { select: { name: true } } } }),
      this.prisma.groupMeal.findMany({ where: { businessId }, orderBy: [{ date: 'asc' }], include: { groupMember: { select: { name: true } } } }),
    ]);
    return [
      { name: 'members.csv', data: toCsv(['Name', 'Phone', 'Status', 'Shares', 'Joined on', 'Left on'], members.map((m) => [m.name, m.phone, m.status, m.shareUnits, day(m.joinedOn), day(m.leftOn)])) },
      { name: 'contributions.csv', data: toCsv(['Date', 'Member', 'Kind', 'Amount', 'Note'], contributions.map((c) => [day(c.date), c.groupMember.name, c.kind, c.amount, c.note])) },
      {
        name: 'expenses.csv',
        data: toCsv(['Date', 'Category', 'Description', 'Amount', 'Paid from', 'Paid by', 'Shared'], expenses.map((e) => [day(e.date), e.category, e.description, e.amount, e.paidFrom, e.paidByMember?.name, e.split])),
      },
      { name: 'meals.csv', data: toCsv(['Date', 'Member', 'Breakfast', 'Lunch', 'Dinner', 'Guests'], meals.map((m) => [day(m.date), m.groupMember.name, m.breakfast, m.lunch, m.dinner, m.guests])) },
    ];
  }
}
