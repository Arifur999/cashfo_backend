import { TodoRepeatKind } from '@prisma/client';

// The days a repeating task lands on. Days are `@db.Date` values: Dates at
// UTC midnight, so their UTC day and weekday are the calendar ones.
export interface RepeatRule {
  kind: TodoRepeatKind;
  // WEEKLY: 0 = Sunday ... 6 = Saturday.
  weekdays: number[];
  // MONTHLY: the day of the month; a shorter month uses its last day.
  monthDay: number | null;
}

export const dayKey = (day: Date): string => day.toISOString().slice(0, 10);

export const dayOf = (key: string): Date => new Date(`${key}T00:00:00.000Z`);

export function addDays(day: Date, count: number): Date {
  const next = new Date(day);
  next.setUTCDate(next.getUTCDate() + count);
  return next;
}

const lastDayOfMonth = (day: Date): number => new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0)).getUTCDate();

export function repeatsOn(rule: RepeatRule, day: Date): boolean {
  switch (rule.kind) {
    case TodoRepeatKind.DAILY:
      return true;
    case TodoRepeatKind.WEEKLY:
      return rule.weekdays.includes(day.getUTCDay());
    case TodoRepeatKind.MONTHLY:
      return rule.monthDay !== null && day.getUTCDate() === Math.min(rule.monthDay, lastDayOfMonth(day));
  }
}

// The days from `from` to `to`, both included, that the rule lands on.
export function repeatDays(rule: RepeatRule, from: Date, to: Date): Date[] {
  const days: Date[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) if (repeatsOn(rule, day)) days.push(day);
  return days;
}
