import { describe, expect, it } from 'vitest';
import { arrangeFeed, feedGroupsFor, mostCommon, type FeedItem } from './admin-feed.js';

const item = (id: string, at: string): FeedItem => ({ id, group: 'SUPPORT', kind: 'TICKET_WAITING', data: {}, at: new Date(at), href: '/admin/support' });

describe('feedGroupsFor', () => {
  it('shows each role only what it can act on', () => {
    expect(feedGroupsFor('SUPER_ADMIN')).toEqual(['MONEY', 'SUPPORT', 'SYSTEM']);
    expect(feedGroupsFor('FINANCE_ADMIN')).toEqual(['MONEY']);
    expect(feedGroupsFor('SUPPORT_ADMIN')).toEqual(['SUPPORT']);
    expect(feedGroupsFor('CONTENT_ADMIN')).toEqual([]);
  });
});

describe('arrangeFeed', () => {
  it('puts the newest first and counts what came after the last look', () => {
    const feed = arrangeFeed([item('a', '2026-10-01T09:00:00Z'), item('b', '2026-10-02T09:00:00Z'), item('c', '2026-10-01T12:00:00Z')], new Date('2026-10-01T10:00:00Z'));
    expect(feed.data.map((row) => row.id)).toEqual(['b', 'c', 'a']);
    expect(feed.unreadCount).toBe(2);
    expect(arrangeFeed([item('a', '2026-10-01T09:00:00Z')], null).unreadCount).toBe(1);
  });
});

describe('mostCommon', () => {
  it('names the value seen most often', () => {
    expect(mostCommon(['/api/reports', '/api/budgets', '/api/reports'])).toBe('/api/reports');
    expect(mostCommon(['a', 'b'])).toBe('a');
    expect(mostCommon([])).toBeNull();
  });
});
