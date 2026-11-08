import type { NotificationPrefs } from '../notification-prefs/notification-prefs.js';
import { WEEK_DAYS } from '../notification-prefs/notification-prefs.js';

const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;

// The Dhaka day a summary is due on at `now`, or null: daily from the
// chosen time each day, weekly from that time on the chosen day; never
// twice on one day (`sentOn`).
export function summaryDueOn(prefs: NotificationPrefs, now: Date, sentOn: string | null): string | null {
  if (prefs.summary.mode === 'off') return null;
  const local = new Date(now.getTime() + DHAKA_OFFSET_MS);
  const day = local.toISOString().slice(0, 10);
  if (sentOn === day) return null;
  if (prefs.summary.mode === 'weekly' && WEEK_DAYS[local.getUTCDay()] !== prefs.summary.day) return null;
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  const [hour, minute] = prefs.summary.time.split(':').map(Number);
  return minutes >= hour * 60 + minute ? day : null;
}

// The days a summary covers: that day, or the week ending on it.
export function summaryRange(mode: 'daily' | 'weekly', day: string): { start: Date; end: Date } {
  const end = new Date(`${day}T00:00:00.000Z`);
  return { start: new Date(end.getTime() - (mode === 'weekly' ? 6 : 0) * 86_400_000), end: new Date(end.getTime() + 86_400_000) };
}
