import type { UserNotificationType } from '@prisma/client';

// One row the bell's feed may get. `key` is unique per user, so a check that
// runs again finds its reminder already there and adds nothing; `data` is
// what the app builds the text from, in the reader's language.
export interface ReminderDraft {
  key: string;
  type: UserNotificationType;
  businessId: string | null;
  data: Record<string, string | number | null>;
  // When it happened, if not now (an announcement's start).
  at?: Date;
}

export interface BudgetLine {
  id: string;
  name: string;
  monthlyLimit: string | null;
  spent: string;
  // The category's Bangla name; null or left out when it has none.
  nameBn?: string | null;
}

export interface DueLine {
  transactionId: string;
  contactId: string;
  contactName: string;
  contactCategory: string;
  direction: 'RECEIVABLE' | 'PAYABLE';
  remainingAmount: string;
  dueDate: Date;
  daysUntilDue: number;
}

export interface GoalLine {
  id: string;
  name: string;
  targetAmount: string;
  currentAmount: string;
  targetDate: Date;
  progressPercent: number;
  paceStatus: 'ON_TRACK' | 'BEHIND' | 'WARNING' | null;
}

export interface AnnouncementLine {
  id: string;
  title: string;
  titleBn: string | null;
  body: string;
  bodyBn: string | null;
  startAt: Date;
}

const dayKey = (date: Date) => date.toISOString().slice(0, 10);

const nameKey = (name: string) => name.trim().toLowerCase();

// A workspace's budget category keeps only the name it was given, so its
// Bangla name is the one the default category of that name has (Content >
// Categories), whatever the case or spaces around it: "Shopping" reads
// "কেনাকাটা", a name of the customer's own has none. The first default of a
// name wins, so pass the active ones first.
export function categoryNamesBn(defaults: { name: string; nameBn: string }[]): (name: string) => string | null {
  const byName = new Map<string, string>();
  for (const category of defaults) {
    const key = nameKey(category.name);
    const nameBn = category.nameBn.trim();
    if (key && nameBn && !byName.has(key)) byName.set(key, nameBn);
  }
  return (name) => byName.get(nameKey(name)) ?? null;
}

// A category past 90% of its limit this month, and again once it goes over:
// "Shopping is at 98% of its limit. Only ৳ 100 left for the rest of
// October." `month` is 'YYYY-MM'; categoryBn is the category's Bangla name,
// or null.
export function budgetReminders(businessId: string, month: string, lines: BudgetLine[]): ReminderDraft[] {
  const drafts: ReminderDraft[] = [];
  for (const line of lines) {
    const limit = Number(line.monthlyLimit ?? 0);
    if (!(limit > 0)) continue;
    const spent = Number(line.spent);
    const percent = Math.floor((spent / limit) * 100);
    if (percent < 90) continue;
    const level = spent > limit ? 'over' : '90';
    drafts.push({
      key: `budget:${line.id}:${month}:${level}`,
      type: 'BUDGET',
      businessId,
      data: { category: line.name, categoryBn: line.nameBn ?? null, percent, left: (limit - spent).toFixed(2), month },
    });
  }
  return drafts;
}

// A loan or credit payment falling due soon, either way: one reminder per
// entry and due date.
export function loanReminders(businessId: string, lines: DueLine[]): ReminderDraft[] {
  return lines.map((line) => ({
    key: `loan:${line.transactionId}:${dayKey(line.dueDate)}`,
    type: 'LOAN_DUE',
    businessId,
    data: {
      name: line.contactName,
      contactId: line.contactId,
      loan: line.contactCategory === 'LOAN' ? 1 : 0,
      direction: line.direction,
      amount: line.remainingAmount,
      dueDate: dayKey(line.dueDate),
      days: line.daysUntilDue,
    },
  }));
}

// Whole months from `today` to `target`, at least 1: what is left to save
// is spread over them.
function monthsLeft(today: Date, target: Date): number {
  const months = (target.getUTCFullYear() - today.getUTCFullYear()) * 12 + target.getUTCMonth() - today.getUTCMonth();
  return Math.max(1, months);
}

// Once a month, how far each active goal has come; a goal that is behind
// says what a month it now takes to reach it in time.
export function savingsReminders(businessId: string, month: string, today: Date, goals: GoalLine[]): ReminderDraft[] {
  const drafts: ReminderDraft[] = [];
  for (const goal of goals) {
    if (goal.paceStatus === null) continue;
    const left = Number(goal.targetAmount) - Number(goal.currentAmount);
    if (left <= 0) continue;
    drafts.push({
      key: `savings:${goal.id}:${month}`,
      type: 'SAVINGS',
      businessId,
      data: {
        goal: goal.name,
        behind: goal.paceStatus === 'ON_TRACK' ? 0 : 1,
        percent: goal.progressPercent,
        perMonth: (left / monthsLeft(today, goal.targetDate)).toFixed(2),
        targetDate: dayKey(goal.targetDate),
        month,
      },
    });
  }
  return drafts;
}

export interface ZakatLine {
  businessId: string;
  // The zakat last worked out on the page, for the due date it was for.
  dueDate: string;
  zakat: number;
  paid: number;
}

// Days before the zakat date the bell says so.
export const ZAKAT_REMIND_DAYS = [30, 3] as const;

// "Your zakat is due in 30 days": once each, while some zakat is left to
// give. The nearer reminder wins when both are due (a first visit 2 days
// before the date gets only the 3-day one).
export function zakatReminders(today: string, lines: ZakatLine[]): ReminderDraft[] {
  const drafts: ReminderDraft[] = [];
  for (const line of lines) {
    const left = line.zakat - line.paid;
    if (left <= 0) continue;
    const days = Math.round((Date.parse(`${line.dueDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
    const at = [...ZAKAT_REMIND_DAYS].reverse().find((limit) => days >= 0 && days <= limit);
    if (at === undefined) continue;
    drafts.push({
      key: `zakat:${line.businessId}:${line.dueDate}:${at}`,
      type: 'ZAKAT',
      businessId: line.businessId,
      data: { dueDate: line.dueDate, days, left: left.toFixed(2), zakat: line.zakat.toFixed(2) },
    });
  }
  return drafts;
}

// An announcement the customer can see, in both languages.
export function announcementReminders(rows: AnnouncementLine[]): ReminderDraft[] {
  return rows.map((row) => ({
    key: `announcement:${row.id}`,
    type: 'ANNOUNCEMENT',
    businessId: null,
    data: { title: row.title, titleBn: row.titleBn, body: row.body, bodyBn: row.bodyBn },
    at: row.startAt,
  }));
}
