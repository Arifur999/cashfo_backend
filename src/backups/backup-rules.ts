import { BackupEvery } from '@prisma/client';

// Automatic backups are made in the night on the Dhaka calendar, from 2:00;
// those the night can't reach by 8:00 wait for the next one.
export const BACKUP_HOUR = 2;
export const BACKUP_UNTIL_HOUR = 8;

// Whether `now` is in that window.
export const inBackupWindow = (now: Date) => {
  const hour = new Date(now.getTime() + 6 * 60 * 60 * 1000).getUTCHours();
  return hour >= BACKUP_HOUR && hour < BACKUP_UNTIL_HOUR;
};

const dayNumber = (key: string) => Math.round(Date.parse(`${key}T00:00:00Z`) / 86_400_000);

// Whether an automatic backup is due on `today` (a Dhaka day, YYYY-MM-DD),
// given the day the last one was taken: every day, or a week after.
export function autoBackupDue(every: BackupEvery, lastOn: string | null, today: string): boolean {
  if (!lastOn) return true;
  const gap = dayNumber(today) - dayNumber(lastOn);
  return every === BackupEvery.DAILY ? gap >= 1 : gap >= 7;
}
