import type { Prisma } from '@prisma/client';
import { type TimeWindow, windowStart } from '../common/time-window.js';

// The Users list's chips beside Plan: when people joined, when they were
// last here, how many workspaces they own, and the order.
export const LAST_ACTIVE_FILTERS = ['today', '7d', '30d', 'over30d', 'never'] as const;
export type LastActiveFilter = (typeof LAST_ACTIVE_FILTERS)[number];

export const WORKSPACE_COUNT_FILTERS = ['1', '2+', '3+'] as const;
export type WorkspaceCountFilter = (typeof WORKSPACE_COUNT_FILTERS)[number];

export const OWNER_SORTS = ['lastActive', 'joined', 'name'] as const;
export type OwnerSort = (typeof OWNER_SORTS)[number];

// What "Joined" and "Last active" ask of a user row.
export function ownerDateFilters(query: { joined?: TimeWindow; lastActive?: LastActiveFilter }, now = new Date()): Prisma.UserWhereInput[] {
  const filters: Prisma.UserWhereInput[] = [];
  if (query.joined && query.joined !== 'all') filters.push({ createdAt: { gte: windowStart(query.joined, now) } });
  switch (query.lastActive) {
    case 'today':
    case '7d':
    case '30d':
      filters.push({ lastLoginAt: { gte: windowStart(query.lastActive, now) } });
      break;
    case 'over30d':
      filters.push({ lastLoginAt: { lt: windowStart('30d', now) } });
      break;
    case 'never':
      filters.push({ lastLoginAt: null });
      break;
  }
  return filters;
}

// How many live workspaces an owner must have: exactly one, or at least two
// or three.
export const workspaceCount = (filter: WorkspaceCountFilter): { equals: number } | { gte: number } =>
  filter === '1' ? { equals: 1 } : { gte: filter === '2+' ? 2 : 3 };

// The list's order; last active, newest first, unless asked otherwise. A
// person who never signed in sorts last.
export const ownerOrderBy = (sort: OwnerSort | undefined): Prisma.UserOrderByWithRelationInput[] => {
  if (sort === 'joined') return [{ createdAt: 'desc' }];
  if (sort === 'name') return [{ name: 'asc' }, { createdAt: 'desc' }];
  return [{ lastLoginAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }];
};
