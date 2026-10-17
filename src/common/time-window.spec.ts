import { describe, expect, it } from 'vitest';
import { createdAtFilter, windowStart } from './time-window.js';

describe('windowStart', () => {
  it('starts today at Dhaka midnight, 18:00 UTC the evening before', () => {
    expect(windowStart('today', new Date('2026-10-17T03:00:00.000Z'))).toEqual(new Date('2026-10-16T18:00:00.000Z'));
  });

  it('starts today on the Dhaka date even when UTC is still on the day before', () => {
    expect(windowStart('today', new Date('2026-10-16T19:30:00.000Z'))).toEqual(new Date('2026-10-16T18:00:00.000Z'));
  });

  it('rolls the other windows back from now', () => {
    const now = new Date('2026-10-17T12:00:00.000Z');
    expect(windowStart('24h', now)).toEqual(new Date('2026-10-16T12:00:00.000Z'));
    expect(windowStart('7d', now)).toEqual(new Date('2026-10-10T12:00:00.000Z'));
  });
});

describe('createdAtFilter', () => {
  const now = new Date('2026-10-17T12:00:00.000Z');

  it('prefers the window over explicit dates', () => {
    expect(createdAtFilter({ within: '24h', dateFrom: '2026-01-01' }, now)).toEqual({ gte: new Date('2026-10-16T12:00:00.000Z') });
  });

  it('turns explicit dates into bounds', () => {
    expect(createdAtFilter({ dateFrom: '2026-10-01T00:00:00.000Z' }, now)).toEqual({ gte: new Date('2026-10-01T00:00:00.000Z') });
  });

  it('filters nothing without either, or for any time', () => {
    expect(createdAtFilter({}, now)).toBeUndefined();
    expect(createdAtFilter({ within: 'all' }, now)).toBeUndefined();
  });
});
