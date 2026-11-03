import {
  beforeFire,
  challengeDay,
  challengeDone,
  dhakaInstant,
  dhakaParts,
  inWindow,
  reminderKey,
  reminderUrl,
  timedFires,
  todoDays,
  windowClocks,
  windowDays,
} from './fire-times.js';

// 2026-10-22 08:00 in Dhaka is 02:00 UTC.
const dhaka = (day: string, clock: string, seconds = 0) => new Date(dhakaInstant(day, clock).getTime() + seconds * 1000);

describe('Dhaka clock', () => {
  it('reads an instant as its Dhaka day, clock and weekday', () => {
    expect(dhakaParts(new Date('2026-10-22T02:00:00.000Z'))).toEqual({ day: '2026-10-22', clock: '08:00', weekday: 4 });
    // 23:30 UTC is already the next morning in Dhaka.
    expect(dhakaParts(new Date('2026-10-21T23:30:00.000Z'))).toEqual({ day: '2026-10-22', clock: '05:30', weekday: 4 });
  });

  it('turns a Dhaka day and clock into the instant', () => {
    expect(dhakaInstant('2026-10-22', '08:00').toISOString()).toBe('2026-10-22T02:00:00.000Z');
    expect(dhakaInstant('2026-10-22', '00:10').toISOString()).toBe('2026-10-21T18:10:00.000Z');
  });
});

describe('the catch-up window', () => {
  const now = dhaka('2026-10-22', '08:00', 30);

  it('is the five minutes up to and including this one', () => {
    expect(inWindow(dhaka('2026-10-22', '08:00'), now)).toBe(true);
    expect(inWindow(dhaka('2026-10-22', '07:56'), now)).toBe(true);
    expect(inWindow(dhaka('2026-10-22', '07:55'), now)).toBe(false);
    expect(inWindow(dhaka('2026-10-22', '08:01'), now)).toBe(false);
    expect(windowClocks(now)).toEqual(['08:00', '07:59', '07:58', '07:57', '07:56']);
  });

  it('touches yesterday in the first minutes after midnight', () => {
    expect(windowDays(now)).toEqual(['2026-10-22']);
    expect(windowDays(dhaka('2026-10-22', '00:02'))).toEqual(['2026-10-21', '2026-10-22']);
    expect(windowClocks(dhaka('2026-10-22', '00:02'))).toEqual(['00:02', '00:01', '00:00', '23:59', '23:58']);
    // To-dos look at tomorrow too: an early task with a long lead fires today.
    expect(todoDays(now)).toEqual(['2026-10-22', '2026-10-23']);
  });
});

describe('timedFires', () => {
  const now = dhaka('2026-10-22', '08:01'); // a Thursday

  it('fires each time in the window', () => {
    const fires = timedFires({ times: ['07:58', '08:01', '09:00'], weekdays: [] }, now);
    expect(fires.map((fire) => fire.clock)).toEqual(['07:58', '08:01']);
    expect(fires[0]).toEqual({ day: '2026-10-22', clock: '07:58', at: dhaka('2026-10-22', '07:58') });
  });

  it('only on the weekdays picked, none picked meaning every day', () => {
    expect(timedFires({ times: ['08:00'], weekdays: [4] }, now)).toHaveLength(1);
    expect(timedFires({ times: ['08:00'], weekdays: [0, 5] }, now)).toHaveLength(0);
  });

  it("fires yesterday's late time just after midnight, on yesterday's weekday", () => {
    const fires = timedFires({ times: ['23:59'], weekdays: [3] }, dhaka('2026-10-22', '00:01'));
    expect(fires).toEqual([{ day: '2026-10-21', clock: '23:59', at: dhaka('2026-10-21', '23:59') }]);
  });

  it('ignores a malformed time', () => {
    expect(timedFires({ times: ['8:00', '24:00'], weekdays: [] }, now)).toEqual([]);
  });
});

describe('beforeFire', () => {
  const fajr = new Date('2026-10-21T22:43:00.000Z'); // 04:43 in Dhaka

  it('fires minutesBefore ahead of the moment', () => {
    expect(beforeFire(fajr, 10, dhaka('2026-10-22', '04:33'))).toEqual({ day: '2026-10-22', clock: '04:33', at: dhaka('2026-10-22', '04:33') });
    expect(beforeFire(fajr, 0, dhaka('2026-10-22', '04:45'))?.clock).toBe('04:43');
    expect(beforeFire(fajr, 10, dhaka('2026-10-22', '04:40'))).toBeNull();
  });

  it('floors a moment with seconds to its minute', () => {
    expect(beforeFire(new Date(fajr.getTime() + 40_000), 0, dhaka('2026-10-22', '04:43'))?.clock).toBe('04:43');
  });

  it('can land on the day before (a to-do just after midnight)', () => {
    expect(beforeFire(dhaka('2026-10-23', '00:15'), 30, dhaka('2026-10-22', '23:45'))).toEqual({
      day: '2026-10-22',
      clock: '23:45',
      at: dhaka('2026-10-22', '23:45'),
    });
  });
});

describe('challenges', () => {
  const createdAt = new Date('2026-10-20T10:00:00.000Z');
  const sheet = (totalDays: number, more: { startsOn?: Date; endedOnDay?: number } = {}) => ({
    createdAt,
    startsOn: more.startsOn ?? null,
    totalDays,
    endedOnDay: more.endedOnDay ?? null,
  });

  it('counts days from the day it was created, and stops once it is over', () => {
    expect(challengeDay(sheet(21), '2026-10-20')).toBe(1);
    expect(challengeDay(sheet(21), '2026-10-22')).toBe(3);
    expect(challengeDay(sheet(3), '2026-10-23')).toBeNull();
    expect(challengeDay(sheet(21), '2026-10-19')).toBeNull();
  });

  it('counts from its start date, and stops after the day it was ended', () => {
    const tomorrow = sheet(21, { startsOn: new Date('2026-10-21T00:00:00.000Z') });
    expect(challengeDay(tomorrow, '2026-10-20')).toBeNull();
    expect(challengeDay(tomorrow, '2026-10-21')).toBe(1);
    expect(challengeDay(sheet(21, { endedOnDay: 2 }), '2026-10-21')).toBe(2);
    expect(challengeDay(sheet(21, { endedOnDay: 2 }), '2026-10-22')).toBeNull();
  });

  it('is done for the day once every item is ticked, or the day itself', () => {
    expect(challengeDone(['Walk', 'No sugar'], ['Walk'])).toBe(false);
    expect(challengeDone(['Walk', 'No sugar'], ['No sugar', 'Walk'])).toBe(true);
    expect(challengeDone([], [])).toBe(false);
    expect(challengeDone([], ['done'])).toBe(true);
  });
});

describe('keys and links', () => {
  it('names the reminder and its firing, so it is written once', () => {
    expect(reminderKey('NAMAZ', 'fajr', { day: '2026-10-22', clock: '04:33', at: new Date() })).toBe('reminder:NAMAZ:fajr:2026-10-22:04:33');
  });

  it('opens the page it is about', () => {
    expect(reminderUrl('HABIT', 'h1')).toBe('/habit-tracker/daily');
    expect(reminderUrl('CHALLENGE', 't1')).toBe('/habit-tracker/habits/others/t1');
    expect(reminderUrl('TODO', 'i1')).toBe('/habit-tracker/todos');
    expect(reminderUrl('NAMAZ', 'fajr')).toBe('/habit-tracker/habits?category=Namaz');
    expect(reminderUrl('RAMADAN', 'iftar')).toBe('/habit-tracker/habits?category=Ramadan');
    expect(reminderUrl('BOOK', 'b1')).toBe('/habit-tracker/habits?category=Book');
    expect(reminderUrl('SKILL', 's1')).toBe('/habit-tracker/habits?category=Course');
  });
});
