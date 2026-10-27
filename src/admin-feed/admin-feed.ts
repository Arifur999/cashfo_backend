import { AdminRole } from '../common/roles.js';

// The admin bell's tabs: what needs a hand on money, on support, and on the
// system (security and errors).
export type FeedGroup = 'MONEY' | 'SUPPORT' | 'SYSTEM';

export type FeedKind = 'PAYMENT_FAILED' | 'PAYMENT_PENDING' | 'PAYOUT_REQUESTED' | 'TICKET_WAITING' | 'SECURITY_FLAG' | 'SIGN_INS_PAUSED' | 'ERRORS';

export interface FeedItem {
  // Stable across reads ("payment:<id>"), for the list's keys.
  id: string;
  group: FeedGroup;
  kind: FeedKind;
  // What the panel builds the row's words from.
  data: Record<string, string | number | null>;
  // When it happened; newer than the admin's last "Mark all as read" means
  // unread.
  at: Date;
  href: string;
}

// Only what a role can act on: finance the money, support the tickets, a
// super admin everything. A content admin has nothing here.
const GROUPS_BY_ROLE: Record<AdminRole, FeedGroup[]> = {
  SUPER_ADMIN: ['MONEY', 'SUPPORT', 'SYSTEM'],
  FINANCE_ADMIN: ['MONEY'],
  SUPPORT_ADMIN: ['SUPPORT'],
  CONTENT_ADMIN: [],
};

export const feedGroupsFor = (role: AdminRole): FeedGroup[] => GROUPS_BY_ROLE[role] ?? [];

const FEED_SIZE = 30;

// Newest first, at most a panel's worth, and how many came after `seenAt`.
export function arrangeFeed(items: FeedItem[], seenAt: Date | null): { data: FeedItem[]; unreadCount: number } {
  const data = [...items].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, FEED_SIZE);
  const unreadCount = data.filter((item) => !seenAt || item.at > seenAt).length;
  return { data, unreadCount };
}

// The value seen most often ("most from /api/reports"); the first one seen
// wins a tie.
export function mostCommon(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: string | null = null;
  for (const [value, count] of counts) if (best === null || count > (counts.get(best) ?? 0)) best = value;
  return best;
}
