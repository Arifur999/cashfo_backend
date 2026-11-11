import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, type Business } from '@prisma/client';
import { dhakaDateKey } from '../common/dhaka.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { stepsOf } from '../todos/todo-text.js';
import { cellText, day, toCsv, type CsvCell } from './csv.js';
import { xlsxWorkbook, type SheetData } from './xlsx.js';
import { zipFiles, type ZipEntry } from './zip.js';

// Settings › Data & privacy › Export: the parts of the records a person may
// pick. Without a pick, everything (and their profile and Habit Tracker).
export const EXPORT_SECTIONS = ['balance', 'ie', 'budget', 'savings', 'loans', 'assets', 'group', 'events'] as const;
export type ExportSection = (typeof EXPORT_SECTIONS)[number];
export interface ExportChoice {
  sections?: ExportSection[];
  // Dated records (transactions, savings entries, events and their gifts,
  // group entries) from and to these days, both included.
  from?: string;
  to?: string;
}
export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
// The most rows of one table the printable copy shows.
const PRINT_ROWS = 3000;

type Tagged = SheetData & { section: ExportSection };
interface Pick {
  all: boolean;
  wants: (section: ExportSection) => boolean;
  dated?: { gte: Date; lte: Date };
}
interface Folder {
  folder: string;
  sheets: SheetData[];
}
const table = (head: string[], rows: CsvCell[][]) => ({ head, rows });
const titleOf = (name: string) => {
  const words = name.replace(/\.csv$/, '').replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

// A folder name a zip tool and every OS accept: no control characters, and
// none of the ones Windows refuses.
const folderName = (name: string) =>
  [...name]
    .filter((ch) => ch.charCodeAt(0) >= 32)
    .join('')
    .replace(/[\\/:*?"<>|]/g, '-')
    .trim()
    .slice(0, 60) || 'Workspace';

// What the .zip says about the PIN-locked workspaces it left out.
const lockedNote = (names: string[]) =>
  [
    'These workspaces are locked with a PIN, so this download left them out:',
    '',
    ...names.map((name) => '- ' + name),
    '',
    'Open each one in Smartly and enter its PIN, then download your data again.',
    '',
  ].join('\r\n');

// The folder for the personal trackers, which belong to the person, not to
// any workspace.
const HABITS_FOLDER = 'Habit Tracker';

// Settings > Resources > Download my data: the customer's profile, their
// Habit Tracker (habits, to-dos, books, skills, Namaz and Ramadan sheets,
// qaza) and every workspace they own, as spreadsheets in one .zip, a folder
// per workspace. Saved passwords (the vault) are left out on purpose, and so
// is a workspace `isShut` says stays shut (a PIN-locked one the download
// carries no unlock for); a note in the .zip names those.
@Injectable()
export class AccountExportService {
  constructor(private readonly prisma: PrismaService) {}

  // The .zip of spreadsheets (csv), or one Excel workbook (xlsx).
  async export(
    userId: string,
    isShut: (workspace: Business) => boolean = () => false,
    choice: ExportChoice = {},
    format: 'csv' | 'xlsx' = 'csv',
  ): Promise<{ fileName: string; data: Buffer; type: string }> {
    const { folders, locked } = await this.folders(userId, isShut, choice);
    const stamp = dhakaDateKey(new Date());
    const picked = (choice.sections?.length ?? 0) > 0 || Boolean(choice.from);
    if (format === 'xlsx') {
      const sheets = folders.flatMap((folder) =>
        folder.sheets.map((sheet) => ({ ...sheet, name: [folder.folder, titleOf(sheet.name)].filter(Boolean).join(' · ') })),
      );
      if (locked.length > 0) sheets.push({ name: 'Locked workspaces', head: ['Locked with a PIN, so left out'], rows: locked.map((name) => [name]) });
      return { fileName: `smartly-export-${stamp}.xlsx`, data: xlsxWorkbook(sheets), type: XLSX_TYPE };
    }
    const files: ZipEntry[] = folders.flatMap((folder) =>
      folder.sheets.map((sheet) => ({ name: folder.folder ? `${folder.folder}/${sheet.name}` : sheet.name, data: toCsv(sheet.head, sheet.rows) })),
    );
    if (locked.length > 0) files.push({ name: 'Locked workspaces.txt', data: Buffer.from(lockedNote(locked), 'utf8') });
    return { fileName: `smartly-${picked ? 'export' : 'data'}-${stamp}.zip`, data: zipFiles(files), type: 'application/zip' };
  }

  // The same tables as text, for the page that prints them (PDF).
  async printable(userId: string, isShut: (workspace: Business) => boolean, choice: ExportChoice) {
    const { folders, locked, owner } = await this.folders(userId, isShut, choice);
    const text = (value: CsvCell) => (value instanceof Date ? dhakaDateKey(value) : cellText(value).replace(/^'(?=[=+\-@\t\r])/, ''));
    return {
      owner,
      folders: folders.map((folder) => ({
        folder: folder.folder,
        sheets: folder.sheets.map((sheet) => ({
          name: titleOf(sheet.name),
          head: sheet.head,
          rows: sheet.rows.slice(0, PRINT_ROWS).map((row) => row.map(text)),
          more: Math.max(0, sheet.rows.length - PRINT_ROWS),
        })),
      })),
      locked,
    };
  }

  private async folders(
    userId: string,
    isShut: (workspace: Business) => boolean,
    choice: ExportChoice,
  ): Promise<{ folders: Folder[]; locked: string[]; owner: string }> {
    if ((choice.from && !choice.to) || (!choice.from && choice.to)) throw new BadRequestException('Pick both dates.');
    if (choice.from && choice.to && choice.from > choice.to) throw new BadRequestException('The start date must be before the end date.');
    const all = !choice.sections?.length;
    const chosen = new Set<ExportSection>(choice.sections?.length ? choice.sections : EXPORT_SECTIONS);
    const pick: Pick = {
      all,
      wants: (section) => chosen.has(section),
      dated: choice.from && choice.to ? { gte: new Date(`${choice.from}T00:00:00.000Z`), lte: new Date(`${choice.to}T00:00:00.000Z`) } : undefined,
    };
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        name: true,
        email: true,
        phone: true,
        address: true,
        preferredLanguage: true,
        createdAt: true,
        ownedBusinesses: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
      },
    });

    const folders: Folder[] = [];
    if (all) {
      folders.push({
        folder: '',
        sheets: [
          {
            name: 'profile.csv',
            ...table(
              ['Name', 'Email', 'Phone', 'Address', 'Language', 'Joined'],
              [[user.name, user.email, user.phone, user.address, user.preferredLanguage, user.createdAt]],
            ),
          },
        ],
      });
      folders.push({ folder: HABITS_FOLDER, sheets: await this.habitSheets(userId) });
    }
    // A workspace that happens to share the trackers' folder name gets its own.
    const used = new Set<string>([HABITS_FOLDER]);
    const shut = user.ownedBusinesses.filter(isShut);
    for (const workspace of user.ownedBusinesses) {
      if (shut.includes(workspace)) continue;
      const sheets =
        workspace.type === 'GROUP'
          ? pick.wants('group')
            ? await this.groupSheets(workspace, pick)
            : []
          : [...(await this.workspaceSheets(workspace, pick)), ...(await this.eventSheets(workspace, pick))].filter((sheet) => pick.wants(sheet.section));
      if (sheets.length === 0) continue;
      // Two workspaces with one name get their own folders.
      let folder = folderName(workspace.isDefault ? 'Personal' : workspace.name);
      for (let n = 2; used.has(folder); n++) folder = `${folderName(workspace.name)} (${n})`;
      used.add(folder);
      folders.push({ folder, sheets: sheets.map(({ name, head, rows }) => ({ name, head, rows })) });
    }
    return { folders, locked: shut.map((workspace) => workspace.name), owner: user.name };
  }

  // A personal or business workspace: wallets, transactions, budgets,
  // savings, assets and the people and banks behind loans; only the
  // sections picked are read.
  private async workspaceSheets(workspace: Business, pick: Pick): Promise<Tagged[]> {
    const businessId = workspace.id;
    const [accounts, transactions, budgets, goals, entries, assets, contacts] = await Promise.all([
      pick.wants('balance')
        ? this.prisma.account.findMany({ where: { businessId }, orderBy: [{ accountType: 'asc' }, { displayOrder: 'asc' }, { name: 'asc' }] })
        : [],
      pick.wants('ie')
        ? this.prisma.transaction.findMany({
            where: { businessId, ...(pick.dated && { transactionDate: pick.dated }) },
            orderBy: [{ transactionDate: 'asc' }, { createdAt: 'asc' }],
            include: { contact: { select: { name: true } }, entries: { include: { account: { select: { name: true } } } } },
          })
        : [],
      pick.wants('budget') ? this.prisma.budgetCategory.findMany({ where: { businessId }, orderBy: [{ type: 'asc' }, { displayOrder: 'asc' }] }) : [],
      pick.wants('savings') ? this.prisma.savingsGoal.findMany({ where: { businessId }, orderBy: { createdAt: 'asc' } }) : [],
      pick.wants('savings')
        ? this.prisma.savingsGoalEntry.findMany({
            where: { businessId, ...(pick.dated && { date: pick.dated }) },
            orderBy: { date: 'asc' },
            include: { savingsGoal: { select: { name: true } } },
          })
        : [],
      pick.wants('assets') ? this.prisma.asset.findMany({ where: { businessId }, orderBy: { purchaseDate: 'asc' } }) : [],
      pick.wants('loans') ? this.prisma.contact.findMany({ where: { businessId }, orderBy: { name: 'asc' } }) : [],
    ]);

    return [
      {
        name: 'wallets-and-accounts.csv',
        section: 'balance',
        ...table(
          ['Name', 'Type', 'Kind', 'Account number', 'Opening balance', 'Current balance', 'Status'],
          accounts.map((a) => [a.name, a.accountType, a.accountSubtype, a.accountNumber, a.openingBalance, a.currentBalance, a.status]),
        ),
      },
      {
        name: 'transactions.csv',
        section: 'ie',
        ...table(
          ['Date', 'Type', 'Description', 'Amount', 'From', 'To', 'Category', 'Contact', 'Reference', 'Due date', 'Status', 'Void reason', 'Recorded at'],
          transactions.map((t) => {
            const debits = t.entries.filter((e) => e.entryType === 'DEBIT');
            const credits = t.entries.filter((e) => e.entryType === 'CREDIT');
            const amount = debits.reduce((sum, e) => sum.plus(e.amount), new Prisma.Decimal(0));
            const categories = [...new Set(t.entries.map((e) => e.categoryId).filter(Boolean))].join('; ');
            return [
              day(t.transactionDate),
              t.transactionType,
              t.description,
              amount,
              credits.map((e) => e.account.name).join('; '),
              debits.map((e) => e.account.name).join('; '),
              categories,
              t.contact?.name,
              t.referenceNo,
              day(t.dueDate),
              t.reversalOfId ? 'REVERSAL' : t.status,
              t.voidedReason,
              t.createdAt,
            ];
          }),
        ),
      },
      {
        name: 'budget-categories.csv',
        section: 'budget',
        ...table(
          ['Type', 'Name', 'Monthly limit'],
          budgets.map((b) => [b.type, b.name, b.monthlyLimit]),
        ),
      },
      {
        name: 'savings-goals.csv',
        section: 'savings',
        ...table(
          ['Name', 'Target amount', 'Target date', 'Months', 'Status', 'Description', 'Created'],
          goals.map((g) => [g.name, g.targetAmount, day(g.targetDate), g.durationMonths, g.status, g.description, g.createdAt]),
        ),
      },
      {
        name: 'savings-entries.csv',
        section: 'savings',
        ...table(
          ['Date', 'Goal', 'Type', 'Amount', 'Notes'],
          entries.map((e) => [day(e.date), e.savingsGoal.name, e.type, e.amount, e.notes]),
        ),
      },
      {
        name: 'assets.csv',
        section: 'assets',
        ...table(
          ['Name', 'Category', 'Bought on', 'Price', 'Current value', 'Status', 'Sold on', 'Sold for', 'Notes'],
          assets.map((a) => [a.name, a.category, day(a.purchaseDate), a.purchasePrice, a.currentValue, a.status, day(a.soldAt), a.soldPrice, a.notes]),
        ),
      },
      {
        name: 'contacts-and-loans.csv',
        section: 'loans',
        ...table(
          ['Name', 'Type', 'Kept under', 'Phone', 'Email', 'Address', 'Opening balance', 'Status', 'Notes'],
          contacts.map((c) => [
            c.name,
            c.type,
            c.category === 'LOAN' ? 'Loans' : 'Dena-Pawna',
            c.phone,
            c.email,
            c.address,
            c.openingBalance,
            c.status,
            c.notes,
          ]),
        ),
      },
    ];
  }

  // The Habit Tracker: every row is the person's own (userId), or hangs off
  // one of their habits, sheets, books or skills.
  private async habitSheets(userId: string): Promise<SheetData[]> {
    const [habits, habitLogs, sheets, todos, repeats, books, bookNotes, bookGoals, skills, skillGoals, prayer, qaza, ramadanPreps] = await Promise.all([
      this.prisma.habit.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.habitLog.findMany({ where: { habit: { userId } }, orderBy: [{ date: 'asc' }], include: { habit: { select: { name: true } } } }),
      this.prisma.habitMonthTracker.findMany({
        where: { userId },
        orderBy: [{ category: 'asc' }, { year: 'asc' }, { month: 'asc' }, { createdAt: 'asc' }],
        include: { checks: { orderBy: [{ day: 'asc' }, { item: 'asc' }] }, paraLogs: { orderBy: { day: 'asc' } } },
      }),
      this.prisma.todoItem.findMany({
        where: { list: { userId } },
        orderBy: [{ list: { date: 'asc' } }, { createdAt: 'asc' }],
        include: { list: { select: { date: true } }, category: { select: { name: true } } },
      }),
      this.prisma.todoRepeat.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.book.findMany({ where: { userId }, orderBy: { createdAt: 'asc' }, include: { logs: { orderBy: { date: 'asc' } } } }),
      this.prisma.bookNote.findMany({ where: { book: { userId } }, orderBy: { createdAt: 'asc' }, include: { book: { select: { title: true } } } }),
      this.prisma.bookGoal.findMany({ where: { userId }, orderBy: { year: 'asc' } }),
      this.prisma.skill.findMany({
        where: { userId, deletedAt: null },
        orderBy: { createdAt: 'asc' },
        include: {
          logs: { orderBy: { date: 'asc' } },
          steps: { orderBy: { position: 'asc' } },
          notes: { orderBy: { date: 'asc' } },
          resources: { orderBy: { createdAt: 'asc' } },
        },
      }),
      this.prisma.skillGoal.findMany({ where: { userId }, orderBy: { year: 'asc' } }),
      this.prisma.prayerSettings.findUnique({ where: { userId } }),
      this.prisma.qazaLog.findMany({ where: { userId }, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.ramadanPrep.findMany({ where: { userId }, orderBy: { year: 'asc' } }),
    ]);

    // My books' own shelves, to name the shelf a book stands on.
    const bookShelves = new Map((await this.prisma.bookShelf.findMany({ where: { userId } })).map((shelf) => [shelf.id, shelf.name]));
    // An hours skill keeps its target, progress and log in minutes.
    const countedIn = (unit: string) => (unit === 'HOURS' ? 'MINUTES' : unit);
    // "Namaz 2026-10", "Ramadan 2026" or a challenge's own name.
    const sheetName = (sheet: (typeof sheets)[number]) => {
      if (sheet.category === 'Others') return sheet.name ?? 'Challenge';
      if (sheet.category === 'Ramadan' || sheet.month === null) return [sheet.category, sheet.year].filter((part) => part !== null).join(' ');
      return `${sheet.category} ${sheet.year}-${String(sheet.month).padStart(2, '0')}`;
    };

    return [
      {
        name: 'habits.csv',
        ...table(
          ['Name', 'Category', 'How often', 'Week days', 'Times a week', 'Target', 'Unit', 'Archived', 'Created'],
          habits.map((h) => [h.name, h.category, h.frequencyType, h.weeklyDays.join(' '), h.weeklyCount, h.targetValue, h.unit, h.isArchived, h.createdAt]),
        ),
      },
      {
        name: 'habit-logs.csv',
        ...table(
          ['Date', 'Habit', 'Done', 'Value', 'Note'],
          habitLogs.map((l) => [day(l.date), l.habit.name, l.completed, l.value, l.note]),
        ),
      },
      {
        name: 'month-sheets.csv',
        ...table(
          ['Sheet', 'Kind', 'Month', 'Year', 'Days', 'Items', 'Fasts made up', 'Starts on', 'Ended on day', 'Created'],
          sheets.map((t) => [
            sheetName(t),
            t.category,
            t.month,
            t.year,
            t.totalDays,
            t.items.join('; '),
            t.category === 'Ramadan' ? t.fastsMadeUp : null,
            t.startsOn ? t.startsOn.toISOString().slice(0, 10) : null,
            t.endedOnDay,
            t.createdAt,
          ]),
        ),
      },
      {
        name: 'month-sheet-checks.csv',
        ...table(
          ['Sheet', 'Kind', 'Day', 'Item', 'Status'],
          sheets.flatMap((t) => t.checks.map((c) => [sheetName(t), t.category, c.day, c.item, t.category === 'Namaz' ? c.status : null])),
        ),
      },
      {
        name: 'ramadan-paras.csv',
        ...table(
          ['Sheet', 'Day', 'Paras'],
          sheets.flatMap((t) => t.paraLogs.map((p) => [sheetName(t), p.day, p.paras])),
        ),
      },
      {
        name: 'ramadan-get-ready.csv',
        ...table(
          ['Ramadan of', 'Steps done'],
          ramadanPreps.map((r) => [r.year, r.items.join('; ')]),
        ),
      },
      {
        name: 'prayer-settings.csv',
        ...table(
          ['City', 'Latitude', 'Longitude', 'Method', 'Asr school', 'Hijri adjustment', 'Qaza counted from'],
          prayer ? [[prayer.city, prayer.latitude, prayer.longitude, prayer.method, prayer.asrSchool, prayer.hijriAdjust, day(prayer.qazaSince)]] : [],
        ),
      },
      {
        name: 'qaza-made-up.csv',
        ...table(
          ['Date', 'Prayer', 'Count', 'Recorded at'],
          qaza.map((q) => [day(q.date), q.prayer, q.count, q.createdAt]),
        ),
      },
      {
        name: 'todos.csv',
        ...table(
          [
            'Date',
            'Task',
            'List',
            'Done',
            'Done at',
            'Priority',
            'Due time',
            'Remind minutes before',
            'Moved from',
            'Times put off',
            'Repeats',
            'Steps',
            'Note',
          ],
          todos.map((t) => [
            t.list.date ? day(t.list.date) : 'Someday',
            t.text,
            t.category?.name ?? 'Personal',
            t.completed,
            t.completedAt,
            t.priority,
            t.dueTime,
            t.remindBefore,
            day(t.movedFrom),
            t.moveCount,
            t.repeatId ? 'yes' : null,
            stepsOf(t.steps)
              .map((step) => `${step.done ? '[x]' : '[ ]'} ${step.text}`)
              .join('; '),
            t.note,
          ]),
        ),
      },
      {
        name: 'todo-repeats.csv',
        ...table(
          ['Task', 'Repeats', 'Week days', 'Day of month', 'Priority', 'Due time', 'Starts on', 'Ends on'],
          repeats.map((r) => [r.text, r.kind, r.weekdays.join(' '), r.monthDay, r.priority, r.dueTime, day(r.startsOn), day(r.endsOn)]),
        ),
      },
      {
        name: 'books.csv',
        ...table(
          ['Title', 'Author', 'Pages', 'Pages read', 'Status', 'Paused', 'Started', 'Finished', 'Added', 'Shelf', 'Price', 'Summary'],
          books.map((b) => [
            b.title,
            b.author,
            b.totalPages,
            b.pagesRead,
            b.status,
            b.pausedAt,
            b.startedAt,
            b.finishedAt,
            b.createdAt,
            bookShelves.get(b.shelf) ?? b.shelf,
            b.price === null ? '' : b.price.toString(),
            b.summary,
          ]),
        ),
      },
      {
        name: 'reading-log.csv',
        ...table(
          ['Date', 'Book', 'Pages', 'From page'],
          books.flatMap((b) => b.logs.map((l) => [day(l.date), b.title, l.pages, l.fromPage])),
        ),
      },
      {
        name: 'book-notes.csv',
        ...table(
          ['Book', 'Page', 'Note', 'Written', 'Day', 'Kind', 'Line from the book'],
          bookNotes.map((n) => [n.book.title, n.page, n.text, n.createdAt, day(n.date), n.kind, n.line]),
        ),
      },
      {
        name: 'reading-goals.csv',
        ...table(
          ['Year', 'Books'],
          bookGoals.map((g) => [g.year, g.target]),
        ),
      },
      {
        name: 'skills.csv',
        ...table(
          [
            'Name',
            'Where',
            'Counted in',
            'Target',
            'Progress',
            'Status',
            'Started',
            'Completed',
            'Added',
            'Category',
            'Already done',
            'Target date',
            'Link',
            'Why',
            'Paused',
          ],
          skills.map((k) => [
            k.name,
            k.source,
            countedIn(k.unit),
            k.target,
            k.progress,
            k.status,
            k.startedAt,
            k.completedAt,
            k.createdAt,
            k.category,
            k.base,
            day(k.targetDate),
            k.link,
            k.why,
            k.pausedAt,
          ]),
        ),
      },
      {
        name: 'skill-log.csv',
        ...table(
          ['Date', 'Skill', 'Amount', 'Counted in', 'What was learned'],
          skills.flatMap((k) => k.logs.map((l) => [day(l.date), k.name, l.amount, countedIn(k.unit), l.note])),
        ),
      },
      {
        name: 'skill-roadmaps.csv',
        ...table(
          ['Skill', 'Step', 'Done', 'Done on'],
          skills.flatMap((k) => k.steps.map((step) => [k.name, step.title, step.done ? 'yes' : 'no', day(step.doneOn)])),
        ),
      },
      {
        name: 'skill-notes.csv',
        ...table(
          ['Skill', 'Day', 'Title', 'Note'],
          skills.flatMap((k) => k.notes.map((note) => [k.name, day(note.date), note.title, note.text])),
        ),
      },
      {
        name: 'skill-resources.csv',
        ...table(
          ['Skill', 'Type', 'Title', 'Link'],
          skills.flatMap((k) => k.resources.map((resource) => [k.name, resource.kind, resource.title, resource.url])),
        ),
      },
      {
        name: 'skill-goals.csv',
        ...table(
          ['Year', 'Skills'],
          skillGoals.map((g) => [g.year, g.target]),
        ),
      },
      ...(await this.writingSheets(userId)),
    ];
  }

  // Habit Tracker > Write: notes and the journal, private entries too (they
  // are the person's own; "Private" says which).
  private async writingSheets(userId: string): Promise<SheetData[]> {
    const [notes, entries] = await Promise.all([
      this.prisma.note.findMany({ where: { userId }, orderBy: { createdAt: 'asc' }, include: { category: { select: { name: true } } } }),
      this.prisma.journalEntry.findMany({ where: { userId }, orderBy: { date: 'asc' }, include: { category: { select: { name: true } } } }),
    ]);
    const MOODS = ['Great', 'Good', 'Okay', 'Low', 'Hard'];
    return [
      {
        name: 'notes.csv',
        ...table(
          ['Kind', 'Title', 'Note', 'Category', 'Tags', 'Pinned', 'Archived', 'Written'],
          notes.map((n) => [n.kind, n.title, n.body, n.category?.name, n.tags.join(' '), n.pinned, n.archived, n.createdAt]),
        ),
      },
      {
        name: 'journal.csv',
        ...table(
          ['Date', 'Kind', 'Mood', 'What went well', 'Grateful for', 'Tomorrow I will', 'Entry', 'Category', 'Tags', 'Private'],
          entries.map((e) => [
            day(e.date),
            e.kind,
            MOODS[e.mood],
            e.wentWell,
            e.gratefulFor,
            e.tomorrow,
            e.body,
            e.category?.name,
            e.tags.join(' '),
            e.isPrivate,
          ]),
        ),
      },
    ];
  }

  // A group: its members, money in, costs and meals.
  private async groupSheets(workspace: Business, pick: Pick): Promise<SheetData[]> {
    const businessId = workspace.id;
    const [members, contributions, expenses, meals] = await Promise.all([
      this.prisma.groupMember.findMany({ where: { businessId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.groupContribution.findMany({
        where: { businessId, ...(pick.dated && { date: pick.dated }) },
        orderBy: { date: 'asc' },
        include: { groupMember: { select: { name: true } } },
      }),
      this.prisma.groupExpense.findMany({
        where: { businessId, ...(pick.dated && { date: pick.dated }) },
        orderBy: { date: 'asc' },
        include: { paidByMember: { select: { name: true } } },
      }),
      this.prisma.groupMeal.findMany({
        where: { businessId, ...(pick.dated && { date: pick.dated }) },
        orderBy: [{ date: 'asc' }],
        include: { groupMember: { select: { name: true } } },
      }),
    ]);
    return [
      {
        name: 'members.csv',
        ...table(
          ['Name', 'Phone', 'Status', 'Shares', 'Joined on', 'Left on'],
          members.map((m) => [m.name, m.phone, m.status, m.shareUnits, day(m.joinedOn), day(m.leftOn)]),
        ),
      },
      {
        name: 'contributions.csv',
        ...table(
          ['Date', 'Member', 'Kind', 'Amount', 'Note'],
          contributions.map((c) => [day(c.date), c.groupMember.name, c.kind, c.amount, c.note]),
        ),
      },
      {
        name: 'expenses.csv',
        ...table(
          ['Date', 'Category', 'Description', 'Amount', 'Paid from', 'Paid by', 'Shared'],
          expenses.map((e) => [day(e.date), e.category, e.description, e.amount, e.paidFrom, e.paidByMember?.name, e.split]),
        ),
      },
      {
        name: 'meals.csv',
        ...table(
          ['Date', 'Member', 'Breakfast', 'Lunch', 'Dinner', 'Guests'],
          meals.map((m) => [day(m.date), m.groupMember.name, m.breakfast, m.lunch, m.dinner, m.guests]),
        ),
      },
    ];
  }

  // Calendar & Events: the events, the gifts given and received at them,
  // and the people.
  private async eventSheets(workspace: Business, pick: Pick): Promise<Tagged[]> {
    if (!pick.wants('events')) return [];
    const businessId = workspace.id;
    const dated = pick.dated && { date: pick.dated };
    const [events, gifts, people] = await Promise.all([
      this.prisma.socialEvent.findMany({
        where: { businessId, ...dated },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
        include: { host: { select: { name: true } } },
      }),
      this.prisma.eventGift.findMany({
        where: { businessId, ...(dated && { event: dated }) },
        orderBy: [{ event: { date: 'asc' } }, { createdAt: 'asc' }],
        include: { event: { select: { title: true, date: true } }, person: { select: { name: true } } },
      }),
      this.prisma.eventPerson.findMany({ where: { businessId }, orderBy: { name: 'asc' } }),
    ]);
    return [
      {
        name: 'events.csv',
        section: 'events',
        ...table(
          ['Date', 'Time', 'Event', 'Type', 'Place', 'Host', 'Reminder'],
          events.map((e) => [day(e.date), e.time, e.title, e.type, e.place, e.host?.name, e.remind]),
        ),
      },
      {
        name: 'event-gifts.csv',
        section: 'events',
        ...table(
          ['Event date', 'Event', 'Person', 'Given or received', 'Kind', 'Item', 'Amount', 'Note', 'In transactions'],
          gifts.map((g) => [day(g.event.date), g.event.title, g.person.name, g.direction, g.kind, g.item, g.amount, g.note, Boolean(g.transactionId)]),
        ),
      },
      {
        name: 'event-people.csv',
        section: 'events',
        ...table(
          ['Name', 'Relation'],
          people.map((p) => [p.name, p.relation]),
        ),
      },
    ];
  }
}
