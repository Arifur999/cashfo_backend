import { BillingCycle } from '@prisma/client';

// Dhaka is a fixed UTC+6.
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;

export interface PaidPayment {
  platformUserId: string;
  planId: string;
  paidAt: Date;
}

export interface PlanCycle {
  id: string;
  billingCycle: BillingCycle;
}

export interface MonthEnd {
  // 'YYYY-MM'
  month: string;
  // The instant the month is over (the next Dhaka month's midnight), or now
  // for the month still running.
  at: Date;
}

// A yearly payment keeps someone paid for twelve months, anything else one.
const monthsCovered = (cycle: BillingCycle) => (cycle === BillingCycle.YEARLY ? 12 : 1);

const addMonths = (date: Date, months: number) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()));

// The last `count` Dhaka months ending with the one `now` is in, oldest first.
export function monthEnds(now: Date, count: number): MonthEnd[] {
  const local = new Date(now.getTime() + DHAKA_OFFSET_MS);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth() + 1;
  const ends: MonthEnd[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const first = new Date(Date.UTC(year, month - 1 - i, 1));
    const over = new Date(Date.UTC(year, month - i, 1) - DHAKA_OFFSET_MS);
    ends.push({ month: first.toISOString().slice(0, 7), at: over > now ? now : over });
  }
  return ends;
}

// How many different people were still inside a paid period of each plan
// at each month end: "paid people at the end of each month".
export function paidPeopleAtMonthEnds(payments: PaidPayment[], plans: PlanCycle[], ends: MonthEnd[]): { month: string; perPlan: Record<string, number> }[] {
  const cycleByPlan = new Map(plans.map((plan) => [plan.id, plan.billingCycle]));
  return ends.map(({ month, at }) => {
    const peopleByPlan = new Map<string, Set<string>>();
    for (const payment of payments) {
      const cycle = cycleByPlan.get(payment.planId);
      if (!cycle || payment.paidAt > at || addMonths(payment.paidAt, monthsCovered(cycle)) <= at) continue;
      let people = peopleByPlan.get(payment.planId);
      if (!people) peopleByPlan.set(payment.planId, (people = new Set()));
      people.add(payment.platformUserId);
    }
    const perPlan: Record<string, number> = {};
    for (const plan of plans) perPlan[plan.id] = peopleByPlan.get(plan.id)?.size ?? 0;
    return { month, perPlan };
  });
}
