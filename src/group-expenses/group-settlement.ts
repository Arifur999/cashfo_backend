// How a group's month settles, for a family and a mess alike. Pure, so it
// is tested on its own and the live view and a closed snapshot agree.
//
//   balance = contributions (returns subtracted) + paid from own pocket
//             - meals x meal rate - share of the other costs
//   + means the member gets money back, - means they have to pay.
//
//   meal rate    = expenses shared by meals / all meal units
//   cash in hand = contributions - expenses paid from the fund
//                = every balance added up (the "account checks out" tick)
//
// Who shares an expense: the members in the group on its date (joined by
// then, not yet left) -- or the ones it names. Amounts are worked out in
// paisa and rounded so the shares add up exactly to the expenses.

export type SplitMode = 'EQUAL' | 'SHARES' | 'MEALS' | 'EXACT';

export interface SettleMember {
  id: string;
  name: string;
  // Still in the group. One archived with no leaving day is treated as gone
  // for the whole period (how archiving worked before leaving days).
  active: boolean;
  joinedOn: string | null; // YYYY-MM-DD
  leftOn: string | null;
  shareUnits: number;
}

export interface SettleExpense {
  amount: number;
  date: string; // YYYY-MM-DD
  // From the group's fund, or out of one member's pocket (credited to them).
  paidFromPocket: boolean;
  paidByMemberId: string | null;
  split: SplitMode;
  // The members it names: units for SHARES, amounts for EXACT, just the
  // members for EQUAL. None means everyone in the group that day.
  splits: { memberId: string; units: number | null; amount: number | null }[];
}

export interface SettleInput {
  start: string;
  end: string;
  // In join order; the order of the rows.
  members: SettleMember[];
  // Signed: a return is negative.
  contributions: { memberId: string; amount: number }[];
  expenses: SettleExpense[];
  // Meal units per member over the period (meal counting on).
  meals: { memberId: string; units: number }[];
  mealsOn: boolean;
}

export interface SettleRow {
  memberId: string;
  name: string;
  // Whether they shared the period's costs (in the group during it).
  sharing: boolean;
  grossDeposited: number;
  returned: number;
  contributed: number;
  pocketPaid: number;
  mealUnits: number;
  mealCost: number;
  otherShare: number;
  share: number;
  balance: number;
}

export interface SettleResult {
  totalExpense: number;
  mealExpense: number;
  mealUnits: number;
  mealRate: number;
  cashInHand: number;
  memberCount: number;
  // The even base share of the whole total (the older, equal-split figure).
  perMemberShare: number;
  rows: SettleRow[];
}

const paisa = (taka: number): number => Math.round(taka * 100);
const taka = (p: number): number => Math.round(p) / 100;

// Whole paisa per member summing exactly to `total`: largest remainder
// first, ties to the later member (the last one absorbed the remainder
// before).
function roundShares(raw: Map<string, number>, order: string[], total: number): Map<string, number> {
  const result = new Map<string, number>();
  let left = total;
  const parts = order.filter((id) => raw.has(id)).map((id, index) => {
    const value = raw.get(id) ?? 0;
    const floor = Math.floor(value + 1e-9);
    left -= floor;
    result.set(id, floor);
    return { id, index, rest: value - floor };
  });
  parts.sort((a, b) => b.rest - a.rest || b.index - a.index);
  for (let i = 0; i < left && parts.length > 0; i++) {
    const part = parts[i % parts.length];
    result.set(part.id, (result.get(part.id) ?? 0) + 1);
  }
  // Float noise can floor one paisa too high: take it back from the smallest.
  for (let i = 0; i < -left && parts.length > 0; i++) {
    const part = parts[parts.length - 1 - (i % parts.length)];
    result.set(part.id, (result.get(part.id) ?? 0) - 1);
  }
  return result;
}

export function settleGroup(input: SettleInput): SettleResult {
  const { start, end } = input;
  const inGroupOn = (member: SettleMember, day: string) =>
    (member.active || member.leftOn !== null) && (member.joinedOn === null || member.joinedOn <= day) && (member.leftOn === null || member.leftOn >= day);
  const inPeriod = (member: SettleMember) => (member.active || member.leftOn !== null) && (member.joinedOn === null || member.joinedOn <= end) && (member.leftOn === null || member.leftOn >= start);
  const sharing = input.members.filter(inPeriod);
  const order = input.members.map((member) => member.id);
  const units = new Map(input.members.map((member) => [member.id, member.shareUnits]));

  const mealUnits = new Map<string, number>();
  for (const meal of input.meals) mealUnits.set(meal.memberId, (mealUnits.get(meal.memberId) ?? 0) + meal.units);
  const totalMealUnits = [...mealUnits.values()].reduce((sum, value) => sum + value, 0);
  const mealsPooled = input.mealsOn && totalMealUnits > 0;

  // Raw (unrounded) paisa each member owes for the costs not shared by meals.
  const other = new Map<string, number>();
  const add = (id: string, p: number) => other.set(id, (other.get(id) ?? 0) + p);
  const pocket = new Map<string, number>();
  let totalPaisa = 0;
  let mealPaisa = 0;
  let fundPaisa = 0;

  for (const expense of input.expenses) {
    const amount = paisa(expense.amount);
    totalPaisa += amount;
    if (expense.paidFromPocket && expense.paidByMemberId) pocket.set(expense.paidByMemberId, (pocket.get(expense.paidByMemberId) ?? 0) + amount);
    else fundPaisa += amount;

    if (expense.split === 'MEALS' && mealsPooled) {
      mealPaisa += amount;
      continue;
    }
    const thatDay = sharing.filter((member) => inGroupOn(member, expense.date));
    const everyone = thatDay.length > 0 ? thatDay : sharing;
    const named = expense.splits.filter((split) => units.has(split.memberId));
    let weights: [string, number][];
    if (expense.split === 'EXACT' && named.length > 0) {
      let rest = amount;
      for (const split of named) {
        const part = paisa(split.amount ?? 0);
        add(split.memberId, part);
        rest -= part;
      }
      // What the named amounts leave over is shared equally.
      if (rest !== 0 && everyone.length > 0) for (const member of everyone) add(member.id, rest / everyone.length);
      continue;
    } else if (expense.split === 'SHARES') {
      weights = named.length > 0 ? named.map((split) => [split.memberId, split.units ?? units.get(split.memberId) ?? 1]) : everyone.map((member) => [member.id, member.shareUnits]);
    } else {
      weights = named.length > 0 ? named.map((split) => [split.memberId, 1]) : everyone.map((member) => [member.id, 1]);
    }
    const sum = weights.reduce((total, [, weight]) => total + weight, 0);
    if (sum > 0) for (const [id, weight] of weights) add(id, (amount * weight) / sum);
  }

  // Meal costs, rounded to add up to what meals shared.
  const rawMeals = new Map<string, number>();
  if (mealPaisa > 0) for (const [id, value] of mealUnits) rawMeals.set(id, (mealPaisa * value) / totalMealUnits);
  const meals = roundShares(rawMeals, order, mealPaisa);
  const shares = roundShares(other, order, totalPaisa - mealPaisa);

  const deposited = new Map<string, number>();
  const returned = new Map<string, number>();
  let contributedPaisa = 0;
  for (const contribution of input.contributions) {
    const amount = paisa(contribution.amount);
    contributedPaisa += amount;
    if (amount < 0) returned.set(contribution.memberId, (returned.get(contribution.memberId) ?? 0) - amount);
    else deposited.set(contribution.memberId, (deposited.get(contribution.memberId) ?? 0) + amount);
  }

  const sharingIds = new Set(sharing.map((member) => member.id));
  const touched = (id: string) => deposited.has(id) || returned.has(id) || pocket.has(id) || meals.has(id) || shares.has(id);
  const rows = [...sharing, ...input.members.filter((member) => !sharingIds.has(member.id) && touched(member.id))].map((member): SettleRow => {
    const gross = deposited.get(member.id) ?? 0;
    const back = returned.get(member.id) ?? 0;
    const pocketPaid = pocket.get(member.id) ?? 0;
    const mealCost = meals.get(member.id) ?? 0;
    const otherShare = shares.get(member.id) ?? 0;
    return {
      memberId: member.id,
      name: member.name,
      sharing: sharingIds.has(member.id),
      grossDeposited: taka(gross),
      returned: taka(back),
      contributed: taka(gross - back),
      pocketPaid: taka(pocketPaid),
      mealUnits: Math.round((mealUnits.get(member.id) ?? 0) * 100) / 100,
      mealCost: taka(mealCost),
      otherShare: taka(otherShare),
      share: taka(mealCost + otherShare),
      balance: taka(gross - back + pocketPaid - mealCost - otherShare),
    };
  });

  return {
    totalExpense: taka(totalPaisa),
    mealExpense: taka(mealPaisa),
    mealUnits: Math.round(totalMealUnits * 100) / 100,
    mealRate: mealPaisa > 0 ? Math.round((mealPaisa / totalMealUnits) * 100) / 10000 : 0,
    cashInHand: taka(contributedPaisa - fundPaisa),
    memberCount: sharing.length,
    perMemberShare: sharing.length > 0 ? taka(Math.floor(totalPaisa / sharing.length)) : 0,
    rows,
  };
}
