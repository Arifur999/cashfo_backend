import { morningDay, morningKey } from './insights-morning.js';

describe('the morning summary', () => {
  it('starts at 7 in the morning in Dhaka, keyed by workspace and day', () => {
    expect(morningDay(new Date('2026-11-07T00:59:00.000Z'))).toBeNull();
    expect(morningDay(new Date('2026-11-07T01:00:00.000Z'))).toBe('2026-11-07');
    expect(morningDay(new Date('2026-11-07T17:59:00.000Z'))).toBe('2026-11-07');
    expect(morningDay(new Date('2026-11-07T19:00:00.000Z'))).toBeNull();
    expect(morningKey('b1', '2026-11-07')).toBe('insight:b1:2026-11-07');
  });
});
