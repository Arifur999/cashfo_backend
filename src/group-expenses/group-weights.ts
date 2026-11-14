// Members' cost-split weights over time (GroupCostWeight). A change of
// shares or of the split counts from the day it is made, so an open month
// shares each expense by the weights of its own date and the months before
// never move. Pure, so it is tested on its own.

export interface WeightRow {
  memberId: string;
  from: string; // YYYY-MM-DD
  weight: number;
}

// The day the weights before the first recorded change start from: before
// any group's first entry.
export const WEIGHTS_SINCE = '2000-01-01';

// A lookup for a member's weight on a day: the latest row dated that day or
// earlier; undefined when there is none (the caller uses the weight now).
export function weightsOn(rows: WeightRow[]): (memberId: string, day: string) => number | undefined {
  const byMember = new Map<string, WeightRow[]>();
  for (const row of [...rows].sort((a, b) => a.from.localeCompare(b.from))) byMember.set(row.memberId, [...(byMember.get(row.memberId) ?? []), row]);
  return (memberId, day) => {
    let found: number | undefined;
    for (const row of byMember.get(memberId) ?? []) {
      if (row.from > day) break;
      found = row.weight;
    }
    return found;
  };
}

// What to write after a change: the weights before it from WEIGHTS_SINCE when
// the group has no history yet, then the new weights from today -- only for
// members whose weight moved, unless this is the first record.
export function weightChanges(input: { hasHistory: boolean; before: Map<string, number>; after: Map<string, number>; today: string }): WeightRow[] {
  const { hasHistory, before, after, today } = input;
  const moved = [...after].some(([id, weight]) => before.get(id) !== weight) || [...before.keys()].some((id) => !after.has(id));
  if (!moved) return [];
  const rows: WeightRow[] = [];
  if (!hasHistory) for (const [memberId, weight] of before) rows.push({ memberId, from: WEIGHTS_SINCE, weight });
  for (const [memberId, weight] of after) rows.push({ memberId, from: today, weight });
  return rows;
}
