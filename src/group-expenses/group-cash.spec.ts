import { cashbook, cashByAccountant, cashMovements, type CashContribution, type CashExpense } from './group-cash.js';

const deposit = (
  id: string,
  date: string,
  amount: number,
  memberName: string,
  receivedByMemberId: string | null,
  kind: CashContribution['kind'] = 'DEPOSIT',
): CashContribution => ({
  id,
  date,
  createdAt: Number(id.replace(/\D/g, '')),
  kind,
  amount,
  memberId: memberName.toLowerCase(),
  memberName,
  receivedByMemberId,
  note: null,
});
const expense = (id: string, date: string, amount: number, paidByMemberId: string | null, paidFromFund = true): CashExpense => ({
  id,
  date,
  createdAt: Number(id.replace(/\D/g, '')),
  amount,
  category: 'Bazar & grocery',
  description: null,
  paidFromFund,
  paidByMemberId,
});

// Khaled and Rakib are the accountants; Khaled holds the cash by default.
const accountants = new Set(['khaled', 'rakib']);
const contributions = [
  deposit('c1', '2026-10-01', 10000, 'Arif', 'khaled'),
  deposit('c2', '2026-10-02', 5000, 'Khaled', null), // an older row: the cash holder's
  deposit('c3', '2026-10-03', 2000, 'Rakib', 'rakib'),
  deposit('c4', '2026-10-04', -1000, 'Arif', 'khaled', 'RETURN'),
  deposit('c5', '2026-10-05', 800, 'Arif', null, 'SETTLE'), // a settle-up moves no group cash
  deposit('c6', '2026-10-01', 300, 'Arif', null, 'CARRY'),
];
const expenses = [
  expense('e7', '2026-10-06', 4000, 'khaled'),
  expense('e8', '2026-10-07', 3200, 'rakib'), // more than Rakib holds: he paid the rest
  expense('e9', '2026-10-08', 500, 'arif'), // a fund expense paid by a member: the cash holder's
  expense('e10', '2026-10-09', 900, 'arif', false), // own pocket: no cash moves
];

describe('group cash by accountant', () => {
  const moves = cashMovements(contributions, expenses, accountants, 'khaled');

  it('counts deposits given to each accountant less returns and fund expenses they paid', () => {
    expect(Object.fromEntries(cashByAccountant(moves))).toEqual({ khaled: 9500, rakib: -1200 });
    expect(Object.fromEntries(cashByAccountant(moves, '2026-10-05'))).toEqual({ khaled: 14000, rakib: 2000 });
  });

  it("writes one accountant's book with the opening, the running cash and the closing", () => {
    const book = cashbook(moves, { accountantId: 'khaled', from: '2026-10-04', to: '2026-10-08' });
    expect(book.opening).toBe(15000);
    expect(book.rows.map((row) => [row.id, row.kind, row.amount, row.balance])).toEqual([
      ['c4', 'OUT', 1000, 14000],
      ['e7', 'OUT', 4000, 10000],
      ['e9', 'OUT', 500, 9500],
    ]);
    expect([book.totalIn, book.totalOut, book.closing, book.inCount, book.outCount]).toEqual([0, 5500, 9500, 0, 3]);
    expect(book.rows[0].returned).toBe(true);
  });

  it('puts every accountant together when none is picked', () => {
    const book = cashbook(moves, {});
    expect(book.closing).toBe(8300);
    expect(book.opening).toBe(0);
  });

  it('moves handed-over cash from one holder to the other, the total unchanged', () => {
    const handed = cashMovements(contributions, expenses, accountants, 'khaled', [
      {
        id: 'h11',
        date: '2026-10-06',
        createdAt: 11,
        amount: 3000,
        fromMemberId: 'khaled',
        fromName: 'Khaled',
        toMemberId: 'rakib',
        toName: 'Rakib',
        note: null,
      },
      { id: 'h12', date: '2026-10-06', createdAt: 12, amount: 0, fromMemberId: 'khaled', fromName: 'Khaled', toMemberId: 'rakib', toName: 'Rakib', note: null },
    ]);
    expect(Object.fromEntries(cashByAccountant(handed))).toEqual({ khaled: 6500, rakib: 1800 });
    expect(cashbook(handed, {}).closing).toBe(8300);
    const rakib = cashbook(handed, { accountantId: 'rakib' }).rows.find((row) => row.source === 'HANDOVER');
    expect(rakib).toMatchObject({ id: 'h11', kind: 'IN', party: 'Khaled', otherId: 'khaled', amount: 3000 });
  });
});
