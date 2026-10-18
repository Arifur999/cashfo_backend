import { TodoRepeatKind } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { addDays, dayKey, dayOf, repeatDays, repeatsOn } from './todo-repeat.js';

const keys = (days: Date[]) => days.map(dayKey);

describe('repeatsOn', () => {
  it('lands every day for DAILY', () => {
    expect(keys(repeatDays({ kind: TodoRepeatKind.DAILY, weekdays: [], monthDay: null }, dayOf('2026-10-02'), dayOf('2026-10-04')))).toEqual(['2026-10-02', '2026-10-03', '2026-10-04']);
  });

  it('lands on the named weekdays for WEEKLY', () => {
    // 2 Oct 2026 is a Friday (5).
    const fridays = repeatDays({ kind: TodoRepeatKind.WEEKLY, weekdays: [5], monthDay: null }, dayOf('2026-10-01'), dayOf('2026-10-20'));
    expect(keys(fridays)).toEqual(['2026-10-02', '2026-10-09', '2026-10-16']);
  });

  it('uses the last day of a short month for MONTHLY', () => {
    const rule = { kind: TodoRepeatKind.MONTHLY, weekdays: [], monthDay: 31 };
    expect(repeatsOn(rule, dayOf('2026-02-28'))).toBe(true);
    expect(repeatsOn(rule, dayOf('2026-03-30'))).toBe(false);
    expect(repeatsOn(rule, dayOf('2026-03-31'))).toBe(true);
  });

  it('steps days across a month end', () => {
    expect(dayKey(addDays(dayOf('2026-10-31'), 1))).toBe('2026-11-01');
  });
});
