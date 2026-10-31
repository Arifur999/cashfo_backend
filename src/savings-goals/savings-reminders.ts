// When a savings goal's reminder emails are due (Dhaka calendar days).

// A reminder day missed while the server was down still goes out for this
// many days after it; older ones are let go rather than arrive late.
export const REMINDER_GRACE_DAYS = 2;
// Catch up's monthly reminder goes out on the 1st, or within this many
// days of it.
export const MONTHLY_LAST_DAY = 3;

const dayNumber = (day: string) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) / 86_400_000;

// The goal's own reminder: due from its day until REMINDER_GRACE_DAYS
// after, and once only (sentFor is the day it already went out for).
export function dateReminderDue(reminderDay: string | null, sentFor: string | null, today: string): boolean {
  if (!reminderDay || reminderDay === sentFor) return false;
  const late = dayNumber(today) - dayNumber(reminderDay);
  return late >= 0 && late <= REMINDER_GRACE_DAYS;
}

// The month ('2026-11') a monthly reminder is due for today, or null.
export function monthlyReminderMonth(today: string, sentFor: string | null): string | null {
  if (Number(today.slice(8, 10)) > MONTHLY_LAST_DAY) return null;
  const month = today.slice(0, 7);
  return month === sentFor ? null : month;
}

// What finishing on time takes each month from now: what is left over the
// months to the end date (30.44 days each, at least one), rounded up to the
// taka -- the figure the app shows as "Needed a month".
export function perMonthFromNow(target: number, saved: number, endDay: string, today: string): number {
  const months = Math.max(1, Math.ceil((dayNumber(endDay) - dayNumber(today)) / 30.44));
  return Math.max(0, Math.ceil((target - saved) / months));
}
