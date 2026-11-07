import { BackupEvery } from '@prisma/client';

// Automatic backups start at 2:00 at night on the Dhaka calendar.
export const BACKUP_HOUR = 2;

const dayNumber = (key: string) => Math.round(Date.parse(`${key}T00:00:00Z`) / 86_400_000);

// Whether an automatic backup is due on `today` (a Dhaka day, YYYY-MM-DD),
// given the day the last one was taken: every day, or a week after.
export function autoBackupDue(every: BackupEvery, lastOn: string | null, today: string): boolean {
  if (!lastOn) return true;
  const gap = dayNumber(today) - dayNumber(lastOn);
  return every === BackupEvery.DAILY ? gap >= 1 : gap >= 7;
}
