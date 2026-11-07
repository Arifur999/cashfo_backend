import type { UserStatus } from '@prisma/client';

// How long a deleted account waits before it is purged. Signing in before
// then restores it (owner decision, 2026-10-27).
export const DELETION_GRACE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export const deletionDate = (requestedAt: Date): Date => new Date(requestedAt.getTime() + DELETION_GRACE_DAYS * DAY_MS);

export interface DeletionState {
  status: UserStatus;
  deletionScheduledFor: Date | null;
}

// Waiting out its 30 days, and still restorable by signing in.
export const isRestorable = (user: DeletionState, now: Date): boolean =>
  user.status === 'PENDING_DELETION' && (user.deletionScheduledFor === null || user.deletionScheduledFor > now);

// Its day has come: purge it before anything else looks at it. A pending
// account with no date (should not happen) is never purged by accident.
export const isPurgeDue = (user: DeletionState, now: Date): boolean =>
  user.status === 'PENDING_DELETION' && user.deletionScheduledFor !== null && user.deletionScheduledFor <= now;

// What the purged User row becomes: no name, no reachable address, nothing
// that leads back to the person. The row itself stays so payments,
// invoices, referrals and tickets keep pointing at something.
export const anonymisedUser = (userId: string) => ({
  name: 'Deleted user',
  email: `deleted+${userId}@deleted.invalid`,
  phone: null,
  avatarUrl: null,
  coverUrl: null,
  address: null,
  profileCardSharedAt: null,
  referralCode: null,
  vaultPasswordHash: null,
  emailVerified: false,
  emailVerifiedAt: null,
  vaultLockMinutes: null,
  vaultUnlockFailures: 0,
  vaultUnlockFailedAt: null,
  failedTriesAlertedAt: null,
  monthlySummaryEmail: false,
  aiInsights: false,
  alertNewDevice: false,
  alertFailedTries: false,
  askCodeBeforeReset: false,
  status: 'DELETED' as const,
});

// The person's own sentence about what goes, for the dialog's list. The
// referral line appears only when there is unwithdrawn money.
export interface DeletionPreviewCounts {
  wallets: number;
  transactions: number;
  savingsGoals: number;
  assets: number;
  loanContacts: number;
  groups: number;
  vaultEntries: number;
  referralAvailable: string | null;
}
