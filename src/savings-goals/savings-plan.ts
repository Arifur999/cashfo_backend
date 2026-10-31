// A goal's plan line and where its money stands against it. Dates are
// Dhaka calendar days ('YYYY-MM-DD'); amounts are taka.
//
// The plan runs in a straight line from what was saved on the plan's first
// day to the target on the end date. A goal more than 3% of its target
// (at least ৳1,000) under that line is Behind; more than 2% over it is
// Ahead; anywhere between is On track.

export type PlanState = 'AHEAD' | 'ON_TRACK' | 'BEHIND';

export interface PlanInput {
  target: number;
  saved: number;
  // The plan's first day and what was saved then.
  planStart: string;
  planStartAmount: number;
  // The goal's end date.
  end: string;
  today: string;
}

export interface PlanPace {
  // What the plan line says should be saved by today, rounded to the taka.
  expected: number;
  // saved − expected: below zero is behind the line.
  difference: number;
  state: PlanState;
}

const dayNumber = (day: string): number => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) / 86_400_000;

// Whole days from one calendar day to another (negative when `to` is earlier).
export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

export function planPace({ target, saved, planStart, planStartAmount, end, today }: PlanInput): PlanPace {
  const total = Math.max(1, daysBetween(planStart, end));
  const elapsed = Math.min(total, Math.max(0, daysBetween(planStart, today)));
  const expected = Math.round(planStartAmount + ((target - planStartAmount) * elapsed) / total);
  const difference = saved - expected;
  const tolerance = Math.max(1000, 0.03 * target);
  const state: PlanState = difference < -tolerance ? 'BEHIND' : difference > 0.02 * target ? 'AHEAD' : 'ON_TRACK';
  return { expected, difference, state };
}
