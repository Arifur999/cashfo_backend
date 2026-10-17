import { ownerDateFilters, ownerOrderBy, workspaceCount } from './owner-filters.js';

describe('ownerDateFilters', () => {
  const now = new Date('2026-10-17T12:00:00.000Z');

  it('asks for nothing without either chip', () => {
    expect(ownerDateFilters({}, now)).toEqual([]);
    expect(ownerDateFilters({ joined: 'all' }, now)).toEqual([]);
  });

  it('reads Joined as a window back from now', () => {
    expect(ownerDateFilters({ joined: '7d' }, now)).toEqual([{ createdAt: { gte: new Date('2026-10-10T12:00:00.000Z') } }]);
  });

  it('reads Last active as a window, a long absence or never', () => {
    expect(ownerDateFilters({ lastActive: '30d' }, now)).toEqual([{ lastLoginAt: { gte: new Date('2026-09-17T12:00:00.000Z') } }]);
    expect(ownerDateFilters({ lastActive: 'over30d' }, now)).toEqual([{ lastLoginAt: { lt: new Date('2026-09-17T12:00:00.000Z') } }]);
    expect(ownerDateFilters({ lastActive: 'never' }, now)).toEqual([{ lastLoginAt: null }]);
  });
});

describe('workspaceCount', () => {
  it('asks for exactly one, or at least two or three', () => {
    expect(workspaceCount('1')).toEqual({ equals: 1 });
    expect(workspaceCount('2+')).toEqual({ gte: 2 });
    expect(workspaceCount('3+')).toEqual({ gte: 3 });
  });
});

describe('ownerOrderBy', () => {
  it('puts the most recently active first by default, never-seen last', () => {
    expect(ownerOrderBy(undefined)[0]).toEqual({ lastLoginAt: { sort: 'desc', nulls: 'last' } });
  });

  it('can order by joining or by name', () => {
    expect(ownerOrderBy('joined')).toEqual([{ createdAt: 'desc' }]);
    expect(ownerOrderBy('name')[0]).toEqual({ name: 'asc' });
  });
});
