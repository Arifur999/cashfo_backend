import { dhakaInstant } from './fire-times.js';
import type { ReminderData } from './reminder-text.js';
import { RemindersScheduler } from './reminders.scheduler.js';

type Row = Record<string, unknown>;

// A prisma with just what a tick reads. `timed` / `prayer` are the Reminder
// rows each query finds; createManyAndReturn returns the rows it is given
// unless `existing` keys are already there.
const setup = ({
  timed = [] as Row[],
  prayer = [] as Row[],
  habits = [] as Row[],
  logs = [] as Row[],
  todos = [] as Row[],
  sheets = [] as Row[],
  existing = [] as string[],
} = {}) => {
  const prisma = {
    reminder: {
      findMany: vi.fn(({ where }: { where: { kind: { in: string[] } } }) => Promise.resolve(where.kind.in.includes('NAMAZ') ? prayer : timed)),
    },
    habit: { findMany: vi.fn().mockResolvedValue(habits) },
    habitLog: { findMany: vi.fn().mockResolvedValue(logs) },
    habitMonthTracker: { findMany: vi.fn().mockResolvedValue(sheets) },
    book: { findMany: vi.fn().mockResolvedValue([]) },
    skill: { findMany: vi.fn().mockResolvedValue([]) },
    prayerSettings: { findMany: vi.fn().mockResolvedValue([]) },
    todoItem: { findMany: vi.fn().mockResolvedValue(todos) },
    userNotification: {
      createManyAndReturn: vi.fn(({ data }: { data: { userId: string; key: string; data: unknown }[] }) =>
        Promise.resolve(data.filter((row) => !existing.includes(row.key)).map((row) => ({ userId: row.userId, data: row.data }))),
      ),
    },
  };
  const push = { send: vi.fn().mockResolvedValue(1) };
  return { scheduler: new RemindersScheduler(prisma as never, push as never), prisma, push };
};

const at = (day: string, clock: string) => new Date(dhakaInstant(day, clock).getTime() + 500);
const walk = { userId: 'u1', kind: 'HABIT', targetKey: 'h1', times: ['07:30'], weekdays: [] };

describe('RemindersScheduler.tick', () => {
  it('writes a due habit to the bell and pushes it in each device language', async () => {
    const { scheduler, prisma, push } = setup({ timed: [walk], habits: [{ id: 'h1', userId: 'u1', name: 'Walk' }] });
    await scheduler.tick(at('2026-10-22', '07:31'));

    const { data } = prisma.userNotification.createManyAndReturn.mock.calls[0][0];
    expect(data).toEqual([
      {
        userId: 'u1',
        key: 'reminder:HABIT:h1:2026-10-22:07:30',
        type: 'REMINDER',
        businessId: null,
        data: { kind: 'HABIT', targetKey: 'h1', name: 'Walk', at: '07:30', url: '/habit-tracker/daily' },
      },
    ]);
    const [messages] = push.send.mock.calls[0] as [{ userId: string; build: (locale: 'en' | 'bn') => { title: string; body: string } }[]];
    expect(messages).toHaveLength(1);
    expect(messages[0].build('bn')).toMatchObject({ title: 'Walk', body: 'আপনার অভ্যাসের সময় হয়েছে' });
  });

  it('pushes nothing for a row an earlier tick already wrote', async () => {
    const { scheduler, push } = setup({ timed: [walk], habits: [{ id: 'h1', userId: 'u1', name: 'Walk' }], existing: ['reminder:HABIT:h1:2026-10-22:07:30'] });
    await scheduler.tick(at('2026-10-22', '07:33'));
    expect(push.send).not.toHaveBeenCalled();
  });

  it("skips a habit already done today, or someone else's", async () => {
    const done = setup({
      timed: [walk],
      habits: [{ id: 'h1', userId: 'u1', name: 'Walk' }],
      logs: [{ habitId: 'h1', date: new Date('2026-10-22T00:00:00.000Z') }],
    });
    await done.scheduler.tick(at('2026-10-22', '07:31'));
    expect(done.prisma.userNotification.createManyAndReturn).not.toHaveBeenCalled();

    const theirs = setup({ timed: [walk], habits: [{ id: 'h1', userId: 'u2', name: 'Walk' }] });
    await theirs.scheduler.tick(at('2026-10-22', '07:31'));
    expect(theirs.prisma.userNotification.createManyAndReturn).not.toHaveBeenCalled();
  });

  it('fires a to-do remindBefore minutes ahead of its time', async () => {
    const task = { id: 'i1', text: 'Call the bank', dueTime: '17:30', remindBefore: 15, list: { userId: 'u1', date: new Date('2026-10-22T00:00:00.000Z') } };
    const { scheduler, prisma } = setup({ todos: [task] });
    await scheduler.tick(at('2026-10-22', '17:16'));
    expect(prisma.userNotification.createManyAndReturn.mock.calls[0][0].data[0]).toMatchObject({
      key: 'reminder:TODO:i1:2026-10-22:17:15',
      data: { kind: 'TODO', targetKey: 'i1', name: 'Call the bank', at: '17:30', minutesBefore: 15, url: '/habit-tracker/todos' },
    });
  });

  it("fires a prayer minutesBefore ahead, unless it's already marked", async () => {
    // Fajr in Dhaka on 22 October 2026 is 04:43.
    const fajr = { userId: 'u1', kind: 'NAMAZ', targetKey: 'fajr', minutesBefore: 10 };
    const open = setup({ prayer: [fajr] });
    await open.scheduler.tick(at('2026-10-22', '04:34'));
    expect(open.prisma.userNotification.createManyAndReturn.mock.calls[0][0].data[0]).toMatchObject({
      key: 'reminder:NAMAZ:fajr:2026-10-22:04:33',
      data: { kind: 'NAMAZ', targetKey: 'fajr', name: 'Fajr', prayer: 'Fajr', at: '04:43', minutesBefore: 10, url: '/habit-tracker/habits?category=Namaz' },
    });

    const marked = setup({ prayer: [fajr], sheets: [{ userId: 'u1', month: 10, year: 2026, checks: [{ day: 22, item: 'Fajr' }] }] });
    await marked.scheduler.tick(at('2026-10-22', '04:34'));
    expect(marked.prisma.userNotification.createManyAndReturn).not.toHaveBeenCalled();
  });

  it('only reminds of Sehri and Iftar during Ramadan', async () => {
    const iftar = { userId: 'u1', kind: 'RAMADAN', targetKey: 'iftar', minutesBefore: 0 };
    const october = setup({ prayer: [iftar] });
    await october.scheduler.tick(at('2026-10-22', '17:27'));
    expect(october.prisma.userNotification.createManyAndReturn).not.toHaveBeenCalled();

    // 1 March 2026 is 12 Ramadan 1447; Iftar in Dhaka is 18:01 that day.
    const ramadan = setup({ prayer: [iftar] });
    await ramadan.scheduler.tick(at('2026-03-01', '18:30'));
    await ramadan.scheduler.tick(at('2026-03-01', '18:05'));
    const rows = ramadan.prisma.userNotification.createManyAndReturn.mock.calls.flatMap((call) => call[0].data);
    expect(rows).toHaveLength(1);
    expect((rows[0].data as ReminderData).name).toBe('Iftar');
  });

  it('survives a failing query and a failing write', async () => {
    const { scheduler, prisma, push } = setup({ timed: [walk], habits: [{ id: 'h1', userId: 'u1', name: 'Walk' }] });
    prisma.habit.findMany.mockRejectedValueOnce(new Error('database down'));
    await expect(scheduler.tick(at('2026-10-22', '07:31'))).resolves.toBeUndefined();
    prisma.userNotification.createManyAndReturn.mockRejectedValueOnce(new Error('database down'));
    await expect(scheduler.tick(at('2026-10-22', '07:31'))).resolves.toBeUndefined();
    expect(push.send).not.toHaveBeenCalled();
  });
});
