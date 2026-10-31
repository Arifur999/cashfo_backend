import { Prisma, type SavingsEntryType } from '@prisma/client';

// Which savings wallet each goal's money sits in, worked out from the goal
// entries alone: money added lands in the wallet it was kept in, a move
// between goals carries its wallets with it (the wallet balance stays the
// same), and a withdrawal leaves the wallets it came out of.
//
// Entries made before the savings wallets were tracked per goal have no
// wallet on a move or a withdrawal: those take from the goal's largest
// holdings first, the same rule a new one is split by, and the receiving
// half of an old move (paired to it by groupId) gets exactly those parts.

export interface HoldingEntry {
  id: string;
  savingsGoalId: string;
  type: SavingsEntryType;
  amount: Prisma.Decimal.Value;
  date: Date;
  createdAt: Date;
  savingsAccountId: string | null;
  groupId: string | null;
}

export interface WalletPart {
  walletId: string;
  amount: Prisma.Decimal;
}

// A goal's money per wallet. The key '' is money whose wallet is not known
// (an old move into a goal that was never paired with its other half).
export type Holdings = Map<string, Prisma.Decimal>;

const ZERO = new Prisma.Decimal(0);

const byAmountThenId = (a: [string, Prisma.Decimal], b: [string, Prisma.Decimal]) => b[1].comparedTo(a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);

// `amount` taken from the largest holdings first. Takes only what is there:
// the parts add up to less than `amount` when the goal holds less.
export function splitLargestFirst(holdings: Holdings, amount: Prisma.Decimal.Value): WalletPart[] {
  let rest = new Prisma.Decimal(amount);
  const parts: WalletPart[] = [];
  for (const [walletId, held] of [...holdings.entries()].filter(([, v]) => v.greaterThan(0)).sort(byAmountThenId)) {
    if (rest.lessThanOrEqualTo(0)) break;
    const take = Prisma.Decimal.min(held, rest);
    parts.push({ walletId, amount: take });
    rest = rest.minus(take);
  }
  return parts;
}

function add(holdings: Holdings, walletId: string, amount: Prisma.Decimal) {
  const next = (holdings.get(walletId) ?? ZERO).plus(amount);
  if (next.isZero()) holdings.delete(walletId);
  else holdings.set(walletId, next);
}

// Takes `amount` out of the named wallet, or largest-first when there is
// none; whatever that wallet doesn't hold comes from the others, so a
// goal's holdings never go below zero. Returns the parts taken.
function take(holdings: Holdings, walletId: string | null, amount: Prisma.Decimal): WalletPart[] {
  const parts: WalletPart[] = [];
  let rest = amount;
  if (walletId !== null) {
    const held = holdings.get(walletId) ?? ZERO;
    const first = Prisma.Decimal.min(Prisma.Decimal.max(held, ZERO), rest);
    if (first.greaterThan(0)) {
      add(holdings, walletId, first.negated());
      parts.push({ walletId, amount: first });
      rest = rest.minus(first);
    }
  }
  if (rest.greaterThan(0)) {
    for (const part of splitLargestFirst(holdings, rest)) {
      add(holdings, part.walletId, part.amount.negated());
      parts.push(part);
    }
  }
  return parts;
}

// A move's two halves are made together: its OUT goes first, so the IN
// finds the parts it took.
const outFirst = (entry: HoldingEntry) => (entry.type === 'TRANSFER_OUT' ? 0 : 1);
const order = (a: HoldingEntry, b: HoldingEntry) =>
  a.date.getTime() - b.date.getTime() || a.createdAt.getTime() - b.createdAt.getTime() || outFirst(a) - outFirst(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// Every goal's holdings, from all of a workspace's entries (any order).
// `parts`, when given, gets which wallets each entry's money was in.
export function goalHoldings(entries: readonly HoldingEntry[], parts?: Map<string, WalletPart[]>): Map<string, Holdings> {
  const byGoal = new Map<string, Holdings>();
  const of = (goalId: string) => {
    let holdings = byGoal.get(goalId);
    if (!holdings) byGoal.set(goalId, (holdings = new Map()));
    return holdings;
  };
  // The parts an old move took out, waiting for its TRANSFER_IN half.
  const moved = new Map<string, WalletPart[]>();

  for (const entry of [...entries].sort(order)) {
    const holdings = of(entry.savingsGoalId);
    const amount = new Prisma.Decimal(entry.amount);
    const record = (taken: WalletPart[]) => parts?.set(entry.id, taken);
    switch (entry.type) {
      case 'CONTRIBUTION':
        add(holdings, entry.savingsAccountId ?? '', amount);
        record([{ walletId: entry.savingsAccountId ?? '', amount }]);
        break;
      case 'WITHDRAWAL':
        record(take(holdings, entry.savingsAccountId, amount));
        break;
      case 'TRANSFER_OUT': {
        const taken = take(holdings, entry.savingsAccountId, amount);
        record(taken);
        if (entry.savingsAccountId === null && entry.groupId) moved.set(entry.groupId, taken);
        break;
      }
      case 'TRANSFER_IN': {
        if (entry.savingsAccountId !== null) {
          add(holdings, entry.savingsAccountId, amount);
          record([{ walletId: entry.savingsAccountId, amount }]);
          break;
        }
        const placed: WalletPart[] = [...((entry.groupId ? moved.get(entry.groupId) : undefined) ?? [])];
        for (const part of placed) add(holdings, part.walletId, part.amount);
        // Whatever the other half couldn't name a wallet for.
        const rest = amount.minus(placed.reduce((total, part) => total.plus(part.amount), ZERO));
        if (rest.greaterThan(0)) {
          add(holdings, '', rest);
          placed.push({ walletId: '', amount: rest });
        }
        record(placed);
        break;
      }
    }
  }
  return byGoal;
}
