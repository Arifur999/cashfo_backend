const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;

// The morning summary goes from 7 AM on the Dhaka calendar.
export const MORNING_HOUR = 7;

// Today's Dhaka day once it is 7 in the morning there, else null.
export function morningDay(now: Date): string | null {
  const local = new Date(now.getTime() + DHAKA_OFFSET_MS);
  return local.getUTCHours() >= MORNING_HOUR ? local.toISOString().slice(0, 10) : null;
}

// One row per workspace and day: a second server or a later tick never
// writes it twice.
export const morningKey = (businessId: string, day: string) => `insight:${businessId}:${day}`;
