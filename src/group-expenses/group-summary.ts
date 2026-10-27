// The group list's month figures (GET /api/businesses/groups/summary): which
// days a group's month covers, and the card's numbers from that month's live
// settlement (settleGroup(), the same maths as the group's own month view).

export interface MonthKey {
  year: number;
  month: number; // 1-12
}

const DAY_MS = 24 * 60 * 60 * 1000;
const pad = (n: number) => String(n).padStart(2, '0');

export const monthKeyText = ({ year, month }: MonthKey): string => `${year}-${pad(month)}`;

export function parseMonthKey(text: string): MonthKey {
  const [year, month] = text.split('-').map(Number);
  return { year, month };
}

// A group month runs from its start day (1-28) to the day before the next
// month's start day, as date-only values (UTC midnight), like the stored dates.
export function groupMonthPeriod({ year, month }: MonthKey, startDay: number): { periodStart: Date; periodEnd: Date } {
  const periodStart = new Date(Date.UTC(year, month - 1, startDay));
  const periodEnd = new Date(Date.UTC(year, month, startDay) - DAY_MS);
  return { periodStart, periodEnd };
}

// The group month today falls in: before the start day, it is still last
// month's (as GroupExpensesService.resolvePeriod() reads it).
export function currentGroupMonth(today: { year: number; month: number; day: number }, startDay: number): MonthKey {
  const index = today.day >= startDay ? today.month - 1 : today.month - 2;
  const at = new Date(Date.UTC(today.year, index, 1));
  return { year: at.getUTCFullYear(), month: at.getUTCMonth() + 1 };
}

export interface SummaryMember {
  name: string;
  contributed: string;
  balance: string;
}

// Who still has to pay, and how much in all: the members whose balance is
// below zero (the card's "To settle" and "... owe ... in total").
export function owing(members: SummaryMember[]): { count: number; total: string; names: string[] } {
  const due = members.filter((member) => Math.round(Number(member.balance) * 100) < 0);
  const paisa = due.reduce((sum, member) => sum - Math.round(Number(member.balance) * 100), 0);
  return { count: due.length, total: (paisa / 100).toFixed(2), names: due.map((member) => member.name) };
}

// Money in over the month, net of returns.
export const collectedOf = (members: SummaryMember[]): string =>
  (members.reduce((sum, member) => sum + Math.round(Number(member.contributed) * 100), 0) / 100).toFixed(2);
