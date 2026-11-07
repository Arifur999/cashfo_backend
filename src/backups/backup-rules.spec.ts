import { BackupEvery } from '@prisma/client';
import { autoBackupDue } from './backup-rules.js';

describe('automatic backups', () => {
  it('are due at once the first time', () => {
    expect(autoBackupDue(BackupEvery.WEEKLY, null, '2026-11-07')).toBe(true);
  });

  it('come every day, or a week after the last', () => {
    expect(autoBackupDue(BackupEvery.DAILY, '2026-11-06', '2026-11-07')).toBe(true);
    expect(autoBackupDue(BackupEvery.DAILY, '2026-11-07', '2026-11-07')).toBe(false);
    expect(autoBackupDue(BackupEvery.WEEKLY, '2026-11-01', '2026-11-07')).toBe(false);
    expect(autoBackupDue(BackupEvery.WEEKLY, '2026-10-31', '2026-11-07')).toBe(true);
    expect(autoBackupDue(BackupEvery.WEEKLY, '2026-12-28', '2027-01-04')).toBe(true);
  });
});
