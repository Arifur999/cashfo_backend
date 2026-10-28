import { toCsv } from '../account-export/csv.js';
import { dhakaDateKey } from '../common/dhaka.js';

// The most rows one Users > Export CSV holds.
export const OWNERS_EXPORT_LIMIT = 10_000;

export interface OwnerCsvRow {
  name: string;
  email: string;
  phone: string | null;
  businessName: string | null;
  workspaceCount: number;
  planName: string | null;
  status: string;
  lastLoginAt: Date | null;
  daysUsing: number;
  deletionScheduledFor: Date | null;
}

const STATUS_WORDS: Record<string, string> = { ACTIVE: 'Active', SUSPENDED: 'Suspended', PENDING_DELETION: 'Being deleted', DELETED: 'Deleted' };
const dhakaDay = (date: Date | null) => (date ? dhakaDateKey(date) : '');

// Users > Export CSV: the columns of the list on screen. Pure.
export function ownersCsv(rows: OwnerCsvRow[], now = new Date()): { fileName: string; data: Buffer } {
  const data = toCsv(
    ['Name', 'Email', 'Phone', 'Workspace', 'Workspaces', 'Plan', 'Status', 'Last active (Dhaka)', 'Using for (days)', 'Deleted on'],
    rows.map((row) => [
      row.name,
      row.email,
      row.phone,
      row.businessName,
      row.workspaceCount,
      row.planName,
      STATUS_WORDS[row.status] ?? row.status,
      dhakaDay(row.lastLoginAt),
      row.daysUsing,
      dhakaDay(row.deletionScheduledFor),
    ]),
  );
  return { fileName: `users-${dhakaDateKey(now)}.csv`, data };
}
