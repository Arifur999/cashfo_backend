// Whose hands a group's cash is in. Pure, so the Cash book, the settlement
// and the expense popup's "Cash with {name}" agree, and it is tested alone.
//
//   an accountant's cash = deposits given to them - money they returned
//                          - expenses they paid from the cash they hold
//
// Settle-ups and carried balances move what members owe each other, not the
// group's cash, so they never count here (the settlement's cash in hand is
// every balance added up, which they don't change either). An older deposit
// or return with no "given to", or a fund expense paid by someone who isn't
// an accountant, is the cash holder's. A negative cash means the accountant
// spent more than they held: they paid the rest themselves and the group
// owes them that.

export interface CashContribution {
  id: string;
  date: string; // YYYY-MM-DD
  createdAt: number;
  kind: 'DEPOSIT' | 'RETURN' | 'SETTLE' | 'CARRY';
  amount: number; // signed: a return is negative
  memberId: string;
  memberName: string;
  receivedByMemberId: string | null;
  note: string | null;
}

export interface CashExpense {
  id: string;
  date: string;
  createdAt: number;
  amount: number;
  category: string;
  description: string | null;
  paidFromFund: boolean;
  paidByMemberId: string | null;
}

// Cash one holder handed to another: out of the giver's cash, into the
// receiver's, nobody's balance changed.
export interface CashHandover {
  id: string;
  date: string;
  createdAt: number;
  amount: number;
  fromMemberId: string;
  fromName: string;
  toMemberId: string;
  toName: string;
  note: string | null;
  // Who recorded it: an Editor changes only their own.
  createdByUserId?: string | null;
}

export interface CashbookRow {
  id: string;
  source: 'CONTRIBUTION' | 'EXPENSE' | 'HANDOVER';
  kind: 'IN' | 'OUT';
  date: string;
  accountantId: string;
  // The member it came from or went back to, or the expense's category.
  party: string;
  // A return paid back to a member (money out to a member, not spending).
  returned: boolean;
  note: string | null;
  amount: number; // positive
  balance: number; // the running cash after it
  // A handover's other holder: who got the cash (OUT) or gave it (IN).
  otherId?: string;
  // A handover's recorder: an Editor changes only their own.
  createdByUserId?: string | null;
}

export interface Cashbook {
  opening: number;
  closing: number;
  totalIn: number;
  totalOut: number;
  inCount: number;
  outCount: number;
  rows: CashbookRow[];
}

const paisa = (taka: number) => Math.round(taka * 100);
const taka = (p: number) => Math.round(p) / 100;

// Every cash movement, in order, with the accountant it belongs to.
export function cashMovements(
  contributions: CashContribution[],
  expenses: CashExpense[],
  accountantIds: Set<string>,
  cashHolderId: string | null,
  handovers: CashHandover[] = [],
): Omit<CashbookRow, 'balance'>[] {
  const holderOf = (id: string | null) => (id && accountantIds.has(id) ? id : cashHolderId);
  const moves: (Omit<CashbookRow, 'balance'> & { createdAt: number })[] = [];
  for (const row of contributions) {
    if (row.kind !== 'DEPOSIT' && row.kind !== 'RETURN') continue;
    const accountantId = row.receivedByMemberId ?? cashHolderId;
    if (!accountantId || row.amount === 0) continue;
    moves.push({
      id: row.id,
      source: 'CONTRIBUTION',
      kind: row.amount > 0 ? 'IN' : 'OUT',
      date: row.date,
      createdAt: row.createdAt,
      accountantId,
      party: row.memberName,
      returned: row.amount < 0,
      note: row.note,
      amount: Math.abs(row.amount),
    });
  }
  for (const row of expenses) {
    if (!row.paidFromFund) continue;
    const accountantId = holderOf(row.paidByMemberId);
    if (!accountantId) continue;
    moves.push({
      id: row.id,
      source: 'EXPENSE',
      kind: 'OUT',
      date: row.date,
      createdAt: row.createdAt,
      accountantId,
      party: row.category,
      returned: false,
      note: row.description,
      amount: row.amount,
    });
  }
  for (const row of handovers) {
    if (!(row.amount > 0)) continue;
    const base = {
      id: row.id,
      source: 'HANDOVER' as const,
      date: row.date,
      createdAt: row.createdAt,
      returned: false,
      note: row.note,
      amount: row.amount,
      createdByUserId: row.createdByUserId ?? null,
    };
    moves.push({ ...base, kind: 'OUT', accountantId: row.fromMemberId, party: row.toName, otherId: row.toMemberId });
    moves.push({ ...base, kind: 'IN', accountantId: row.toMemberId, party: row.fromName, otherId: row.fromMemberId });
  }
  moves.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt || (a.kind === b.kind ? 0 : a.kind === 'OUT' ? -1 : 1));
  return moves.map(({ createdAt: _createdAt, ...move }) => move);
}

// Each accountant's cash after every movement up to `until` (inclusive).
export function cashByAccountant(moves: Omit<CashbookRow, 'balance'>[], until?: string): Map<string, number> {
  const cash = new Map<string, number>();
  for (const move of moves) {
    if (until && move.date > until) continue;
    const signed = move.kind === 'IN' ? paisa(move.amount) : -paisa(move.amount);
    cash.set(move.accountantId, (cash.get(move.accountantId) ?? 0) + signed);
  }
  return new Map([...cash].map(([id, p]) => [id, taka(p)]));
}

// One accountant's book (or every accountant's, together) between two days:
// what they held before it, each movement with the running cash, and after.
export function cashbook(moves: Omit<CashbookRow, 'balance'>[], filter: { accountantId?: string; from?: string; to?: string }): Cashbook {
  const mine = moves.filter((move) => !filter.accountantId || move.accountantId === filter.accountantId);
  let running = 0;
  let totalIn = 0;
  let totalOut = 0;
  let inCount = 0;
  let outCount = 0;
  const rows: CashbookRow[] = [];
  for (const move of mine) {
    if (filter.to && move.date > filter.to) break;
    const signed = move.kind === 'IN' ? paisa(move.amount) : -paisa(move.amount);
    running += signed;
    if (filter.from && move.date < filter.from) continue;
    if (move.kind === 'IN') {
      totalIn += paisa(move.amount);
      inCount++;
    } else {
      totalOut += paisa(move.amount);
      outCount++;
    }
    rows.push({ ...move, balance: taka(running) });
  }
  const closing = running;
  const opening = closing - totalIn + totalOut;
  return { opening: taka(opening), closing: taka(closing), totalIn: taka(totalIn), totalOut: taka(totalOut), inCount, outCount, rows };
}
