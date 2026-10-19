import { describe, expect, it } from 'vitest';
import { isWeakPassword, securityCheckup } from './vault-checkup.js';

const person = { name: 'Khaled Mahmud', phone: '01711-482915' };

describe('isWeakPassword', () => {
  it('calls short, one-kind, common and patterned passwords weak', () => {
    for (const password of ['Ab1!', 'abcdefghijkl', 'MyPassword9', 'Xy1234zz!', 'Zaaaa9!q', 'Khaled#2024', 'Pin482915x']) {
      expect(isWeakPassword(password, person), password).toBe(true);
    }
  });

  it('lets a varied, unpatterned password through', () => {
    expect(isWeakPassword('tR7#vLq2!mNw', person)).toBe(false);
    expect(isWeakPassword('correct-Horse-battery-7', person)).toBe(false);
  });
});

describe('securityCheckup', () => {
  const now = new Date('2026-10-02T00:00:00.000Z');
  const at = (day: string) => new Date(`${day}T00:00:00.000Z`);

  it('lists weak, reused and year-old passwords by id', () => {
    const entries = [
      { id: 'a', password: 'tR7#vLq2!mNw', passwordChangedAt: at('2026-09-01'), checkupDismissedAt: null },
      { id: 'b', password: 'tR7#vLq2!mNw', passwordChangedAt: at('2026-09-01'), checkupDismissedAt: null },
      { id: 'c', password: 'qwerty12', passwordChangedAt: at('2026-09-01'), checkupDismissedAt: null },
      { id: 'd', password: 'G8$kPz!x4Wq1', passwordChangedAt: at('2025-08-01'), checkupDismissedAt: null },
    ];
    expect(securityCheckup(entries, person, now)).toEqual({ weak: ['c'], reused: ['a', 'b'], old: ['d'] });
  });

  it("hides an old password marked fine until it changes again", () => {
    const old = { id: 'd', password: 'G8$kPz!x4Wq1', passwordChangedAt: at('2025-08-01'), checkupDismissedAt: at('2026-09-20') };
    expect(securityCheckup([old], person, now).old).toEqual([]);
    expect(securityCheckup([{ ...old, passwordChangedAt: at('2026-09-25'), checkupDismissedAt: at('2026-09-20') }], person, now).old).toEqual([]);
    expect(securityCheckup([{ ...old, checkupDismissedAt: at('2025-07-01') }], person, now).old).toEqual(['d']);
    // A weak password marked fine for its age is still weak.
    expect(securityCheckup([{ ...old, password: 'qwerty12' }], person, now)).toEqual({ weak: ['d'], reused: [], old: [] });
  });
});
