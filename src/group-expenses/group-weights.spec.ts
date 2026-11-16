import { describe, expect, it } from 'vitest';
import { settleGroup, type SettleMember } from './group-settlement.js';
import { weightChanges, weightsOn, WEIGHTS_SINCE } from './group-weights.js';

describe('weightsOn', () => {
  const on = weightsOn([
    { memberId: 'a', from: WEIGHTS_SINCE, weight: 37.5 },
    { memberId: 'a', from: '2026-11-14', weight: 33.33 },
    { memberId: 'b', from: WEIGHTS_SINCE, weight: 12.5 },
  ]);

  it('reads the latest weight dated that day or earlier', () => {
    expect(on('a', '2026-10-31')).toBe(37.5);
    expect(on('a', '2026-11-13')).toBe(37.5);
    expect(on('a', '2026-11-14')).toBe(33.33);
    expect(on('a', '2026-12-01')).toBe(33.33);
    expect(on('b', '2026-12-01')).toBe(12.5);
  });

  it('knows nothing of a member without history', () => {
    expect(on('c', '2026-11-14')).toBeUndefined();
  });
});

describe('weightChanges', () => {
  const before = new Map([
    ['a', 37.5],
    ['b', 12.5],
    ['c', 50],
  ]);
  const after = new Map([
    ['a', 33.33],
    ['b', 22.22],
    ['c', 44.45],
  ]);

  it('writes the weights before the first change from the start, then the new ones from today', () => {
    expect(weightChanges({ hasHistory: false, before, after, today: '2026-11-14' })).toEqual([
      { memberId: 'a', from: WEIGHTS_SINCE, weight: 37.5 },
      { memberId: 'b', from: WEIGHTS_SINCE, weight: 12.5 },
      { memberId: 'c', from: WEIGHTS_SINCE, weight: 50 },
      { memberId: 'a', from: '2026-11-14', weight: 33.33 },
      { memberId: 'b', from: '2026-11-14', weight: 22.22 },
      { memberId: 'c', from: '2026-11-14', weight: 44.45 },
    ]);
  });

  it('writes only today once a history exists', () => {
    expect(weightChanges({ hasHistory: true, before, after, today: '2026-11-14' }).every((row) => row.from === '2026-11-14')).toBe(true);
  });

  it('writes nothing when no weight moved', () => {
    expect(weightChanges({ hasHistory: false, before, after: new Map(before), today: '2026-11-14' })).toEqual([]);
  });

  it('counts a member who left as a change', () => {
    const left = new Map([
      ['a', 50],
      ['c', 50],
    ]);
    expect(weightChanges({ hasHistory: true, before, after: left, today: '2026-11-14' })).toHaveLength(2);
  });
});

describe('settleGroup with a weight history', () => {
  const member = (id: string, shareUnits: number): SettleMember => ({ id, name: id, active: true, joinedOn: null, leftOn: null, shareUnits });
  // Shares were 3/1/4 (37.5/12.5/50); on 14 Nov Arif went to 2 (33.33/22.22/44.45).
  const weightOn = weightsOn([
    { memberId: 'n', from: WEIGHTS_SINCE, weight: 37.5 },
    { memberId: 'arif', from: WEIGHTS_SINCE, weight: 12.5 },
    { memberId: 'rakib', from: WEIGHTS_SINCE, weight: 50 },
    { memberId: 'n', from: '2026-11-14', weight: 33.33 },
    { memberId: 'arif', from: '2026-11-14', weight: 22.22 },
    { memberId: 'rakib', from: '2026-11-14', weight: 44.45 },
  ]);
  const members = [member('n', 33.33), member('arif', 22.22), member('rakib', 44.45)];
  const bazar = (date: string, amount: number) => ({ amount, date, paidFromPocket: false, paidByMemberId: 'n', split: 'SHARES' as const, splits: [] });

  it('shares an earlier expense by the weights of its date, a later one by the new weights', () => {
    const result = settleGroup({
      start: '2026-11-01',
      end: '2026-11-30',
      members,
      contributions: [],
      expenses: [bazar('2026-11-05', 12390), bazar('2026-11-20', 900)],
      meals: [],
      mealsOn: false,
      weightOn,
    });
    const share = Object.fromEntries(result.rows.map((row) => [row.memberId, row.otherShare]));
    // 12,390 at 37.5/12.5/50 = 4,646.25 / 1,548.75 / 6,195; 900 at 33.33/22.22/44.45 = 299.97 / 199.98 / 400.05.
    expect(share).toEqual({ n: 4946.22, arif: 1748.73, rakib: 6595.05 });
    expect(Math.round((share.n + share.arif + share.rakib) * 100)).toBe(1329000);
  });

  it('without a history uses the weights now', () => {
    const result = settleGroup({ start: '2026-11-01', end: '2026-11-30', members, contributions: [], expenses: [bazar('2026-11-05', 900)], meals: [], mealsOn: false });
    expect(result.rows.map((row) => row.otherShare)).toEqual([299.97, 199.98, 400.05]);
  });
});
