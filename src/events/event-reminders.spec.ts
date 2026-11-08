import { reminderDay, reminderKey } from './event-reminders.js';

describe('reminderDay', () => {
  it('is tomorrow in Dhaka from 9 in the morning', () => {
    // 03:00 UTC is 09:00 in Dhaka.
    expect(reminderDay(new Date('2026-11-05T03:00:00.000Z'))).toBe('2026-11-06');
    expect(reminderDay(new Date('2026-11-05T17:59:00.000Z'))).toBe('2026-11-06');
  });

  it('waits before 9, and turns over at Dhaka midnight', () => {
    expect(reminderDay(new Date('2026-11-05T02:59:00.000Z'))).toBeNull();
    // 18:00 UTC on the 5th is midnight on the 6th in Dhaka: not 9 yet.
    expect(reminderDay(new Date('2026-11-05T18:00:00.000Z'))).toBeNull();
    expect(reminderDay(new Date('2026-12-31T05:00:00.000Z'))).toBe('2027-01-01');
  });

  it('keys a reminder by its event and day', () => {
    expect(reminderKey('e1', '2026-11-06')).toBe('event:e1:2026-11-06');
  });
});
