// When an event's day-before reminder is due, worked out from the clock
// alone. Pure, so it is tested on its own.

const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
// The reminder goes out the day before, from 9 in the morning (Dhaka).
export const REMINDER_HOUR = 9;

// The event day whose reminders are due at `now`: tomorrow in Dhaka, once
// it is past REMINDER_HOUR today; null before then.
export function reminderDay(now: Date): string | null {
  const local = new Date(now.getTime() + DHAKA_OFFSET_MS);
  if (local.getUTCHours() < REMINDER_HOUR) return null;
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1)).toISOString().slice(0, 10);
}

// Today on the Dhaka calendar once it is past REMINDER_HOUR; null before:
// reminders go out from then, as early before each event as its owner
// asked (Settings › Notifications).
export function reminderToday(now: Date): string | null {
  const local = new Date(now.getTime() + DHAKA_OFFSET_MS);
  return local.getUTCHours() < REMINDER_HOUR ? null : local.toISOString().slice(0, 10);
}

// Whole days from one Dhaka day to another.
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

// The bell row's key: one per event and day, so a moved event reminds again.
export const reminderKey = (eventId: string, day: string) => `event:${eventId}:${day}`;
