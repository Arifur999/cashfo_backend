import { weekStartOf } from './week-start.js';

describe('weekStartOf', () => {
  // 2026-10-02 is a Friday.
  it('opens the week on Saturday by default', () => {
    expect(weekStartOf('2026-10-02')).toBe('2026-09-26');
    expect(weekStartOf('2026-10-03')).toBe('2026-10-03');
  });

  it('follows the chosen week start', () => {
    expect(weekStartOf('2026-10-02', 'SUNDAY')).toBe('2026-09-27');
    expect(weekStartOf('2026-10-02', 'MONDAY')).toBe('2026-09-28');
    expect(weekStartOf('2026-09-28', 'MONDAY')).toBe('2026-09-28');
    expect(weekStartOf('2026-09-27', 'MONDAY')).toBe('2026-09-21');
  });
});
