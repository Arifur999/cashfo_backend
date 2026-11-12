import { describe, expect, it } from 'vitest';
import { settleGroup, type SettleExpense, type SettleInput, type SettleMember } from './group-settlement.js';

const member = (id: string, extra: Partial<SettleMember> = {}): SettleMember => ({ id, name: id, active: true, joinedOn: null, leftOn: null, shareUnits: 1, ...extra });
const expense = (amount: number, extra: Partial<SettleExpense> = {}): SettleExpense => ({ amount, date: '2026-09-15', paidFromPocket: false, paidByMemberId: null, split: 'EQUAL', splits: [], ...extra });
const month = (input: Partial<SettleInput>): SettleInput => ({ start: '2026-09-01', end: '2026-09-30', members: [], contributions: [], expenses: [], meals: [], mealsOn: false, ...input });
const row = (result: ReturnType<typeof settleGroup>, id: string) => result.rows.find((r) => r.memberId === id);
const sum = (result: ReturnType<typeof settleGroup>) => Math.round(result.rows.reduce((total, r) => total + r.balance, 0) * 100) / 100;

describe('settleGroup', () => {
  it('splits equally as before, the last member taking the paisa left over', () => {
    const result = settleGroup(month({ members: [member('a'), member('b'), member('c')], contributions: [{ memberId: 'a', amount: 1000 }], expenses: [expense(1000)] }));
    expect(result.rows.map((r) => r.share)).toEqual([333.33, 333.33, 333.34]);
    expect(result).toMatchObject({ totalExpense: 1000, memberCount: 3, perMemberShare: 333.33, cashInHand: 0 });
    expect(row(result, 'a')?.balance).toBe(666.67);
  });

  it('works out a mess: meals at the meal rate, the rest equally (Hall 102)', () => {
    const members = ['tanvir', 'arif', 'sabbir', 'rakib', 'nayeem'].map((id) => member(id));
    const meals = [64, 70, 60, 66, 60].map((units, i) => ({ memberId: members[i].id, units }));
    const result = settleGroup(
      month({
        members,
        mealsOn: true,
        meals,
        contributions: [{ memberId: 'tanvir', amount: 7000 }],
        expenses: [expense(19840, { split: 'MEALS' }), expense(21030)],
      }),
    );
    expect(result.mealRate).toBe(62);
    expect(result.mealUnits).toBe(320);
    expect(row(result, 'tanvir')).toMatchObject({ mealCost: 3968, otherShare: 4206, balance: -1174 });
    expect(sum(result)).toBe(result.cashInHand);
  });

  it('shares a family bazar by shares and credits bills paid from a pocket (Mirpur Family)', () => {
    const members = [member('khaled', { shareUnits: 3 }), member('arif', { shareUnits: 1 }), member('rakib', { shareUnits: 4 })];
    const result = settleGroup(
      month({
        members,
        contributions: [{ memberId: 'khaled', amount: 20000 }],
        expenses: [expense(24000, { split: 'SHARES' }), expense(3000, { paidFromPocket: true, paidByMemberId: 'arif' })],
      }),
    );
    expect(row(result, 'khaled')).toMatchObject({ otherShare: 10000 });
    expect(row(result, 'arif')).toMatchObject({ pocketPaid: 3000, otherShare: 4000, balance: -1000 });
    expect(row(result, 'rakib')?.otherShare).toBe(13000);
    // The pocket payment never left the fund.
    expect(result.cashInHand).toBe(20000 - 24000);
    expect(sum(result)).toBe(result.cashInHand);
  });

  it('shares only with the members there on the day', () => {
    const members = [member('a'), member('b', { joinedOn: '2026-09-16' }), member('c', { active: false, leftOn: '2026-09-10' })];
    const result = settleGroup(month({ members, expenses: [expense(900, { date: '2026-09-05' }), expense(600, { date: '2026-09-20' })] }));
    expect(row(result, 'a')?.share).toBe(750);
    expect(row(result, 'b')?.share).toBe(300);
    expect(row(result, 'c')?.share).toBe(450);
    expect(result.memberCount).toBe(3);
  });

  it('lists an archived member who put money in, with no share', () => {
    const result = settleGroup(month({ members: [member('a'), member('gone', { active: false })], contributions: [{ memberId: 'gone', amount: 500 }, { memberId: 'gone', amount: -200 }], expenses: [expense(100)] }));
    expect(row(result, 'gone')).toMatchObject({ sharing: false, grossDeposited: 500, returned: 200, contributed: 300, share: 0, balance: 300 });
    expect(result.memberCount).toBe(1);
  });

  it('takes exact amounts and shares only with the members an expense names', () => {
    const members = [member('a'), member('b'), member('c')];
    const result = settleGroup(
      month({
        members,
        expenses: [
          expense(1000, { split: 'EXACT', splits: [{ memberId: 'a', units: null, amount: 700 }, { memberId: 'b', units: null, amount: 300 }] }),
          expense(500, { splits: [{ memberId: 'b', units: null, amount: null }, { memberId: 'c', units: null, amount: null }] }),
        ],
      }),
    );
    expect(result.rows.map((r) => r.share)).toEqual([700, 550, 250]);
  });

  it('shares meals equally when meal counting is off', () => {
    const result = settleGroup(month({ members: [member('a'), member('b')], meals: [{ memberId: 'a', units: 10 }], expenses: [expense(100, { split: 'MEALS' })] }));
    expect(result.rows.map((r) => r.share)).toEqual([50, 50]);
    expect(result.mealRate).toBe(0);
  });
});

describe('money given leaves out settle-ups and carried balances', () => {
  it('keeps them in the balance but out of grossDeposited and returned', () => {
    const result = settleGroup(
      month({
        members: [member('a'), member('b')],
        contributions: [
          { memberId: 'a', amount: 1000, kind: 'DEPOSIT' },
          { memberId: 'a', amount: 500, kind: 'CARRY' },
          { memberId: 'b', amount: 300, kind: 'SETTLE' },
          { memberId: 'a', amount: -300, kind: 'SETTLE' },
          { memberId: 'b', amount: -100, kind: 'RETURN' },
        ],
        expenses: [expense(1000)],
      }),
    );
    const a = row(result, 'a')!;
    const b = row(result, 'b')!;
    expect(a.grossDeposited).toBe(1000);
    expect(a.returned).toBe(0);
    expect(a.contributed).toBe(1200);
    expect(a.balance).toBe(700);
    expect(b.grossDeposited).toBe(0);
    expect(b.returned).toBe(100);
    expect(b.contributed).toBe(200);
    expect(b.balance).toBe(-300);
  });
});
