import { dhakaDayStart } from './dhaka.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// The "When" choices the admin lists offer (audit log, sign-ins, errors):
// today on the Dhaka calendar, a window that ends now, or any time ('all',
// which a list opening on a narrower window needs to be able to say).
export const TIME_WINDOWS = ['today', '24h', '7d', '30d', 'all'] as const;
export type TimeWindow = (typeof TIME_WINDOWS)[number];

const ROLLING_MS: Record<Exclude<TimeWindow, 'today' | 'all'>, number> = { '24h': DAY_MS, '7d': 7 * DAY_MS, '30d': 30 * DAY_MS };

export const windowStart = (window: Exclude<TimeWindow, 'all'>, now = new Date()): Date =>
  window === 'today' ? dhakaDayStart(now) : new Date(now.getTime() - ROLLING_MS[window]);

// A list's createdAt filter from its query: a window wins over explicit
// dates; neither means no filter.
export const createdAtFilter = (query: { within?: TimeWindow; dateFrom?: string; dateTo?: string }, now = new Date()): { gte?: Date; lte?: Date } | undefined => {
  if (query.within && query.within !== 'all') return { gte: windowStart(query.within, now) };
  if (!query.dateFrom && !query.dateTo) return undefined;
  return {
    ...(query.dateFrom && { gte: new Date(query.dateFrom) }),
    ...(query.dateTo && { lte: new Date(query.dateTo) }),
  };
};
