import { Prisma, type SavingsGoal, type SavingsPlan, type SavingsPlanHorizon, type SavingsPlanPriority, type SavingsReminderChannel, type SavingsGoalStatus } from '@prisma/client';

// What Undo needs to put a plan or a goal back exactly as it was. Start goal
// keeps the plan on the goal it made (SavingsGoal.fromPlan); Move back to
// plans keeps the goal on the plan it made (SavingsPlan.fromGoal). Money
// is a string and days are ISO strings, as JSON holds them.

export interface PlanSnapshot {
  name: string;
  category: string;
  color: string;
  amount: string;
  horizon: SavingsPlanHorizon;
  needBy: string | null;
  priority: SavingsPlanPriority;
  note: string | null;
  link: string | null;
  plannedOn: string;
}

export interface GoalSnapshot {
  id: string;
  name: string;
  targetAmount: string;
  targetDate: string;
  durationMonths: number;
  reminderDate: string | null;
  reminderChannel: SavingsReminderChannel | null;
  description: string | null;
  status: SavingsGoalStatus;
  startAmount: string;
  planStartDate: string | null;
  planStartAmount: string | null;
  reachedAt: string | null;
  monthlyReminder: boolean;
  color: string | null;
  accountId: string | null;
  createdAt: string;
}

const iso = (date: Date | null) => (date ? date.toISOString() : null);
const day = (value: string | null) => (value ? new Date(value) : null);

export function toPlanSnapshot(plan: SavingsPlan): PlanSnapshot {
  return {
    name: plan.name,
    category: plan.category,
    color: plan.color,
    amount: new Prisma.Decimal(plan.amount).toFixed(2),
    horizon: plan.horizon,
    needBy: iso(plan.needBy),
    priority: plan.priority,
    note: plan.note,
    link: plan.link,
    plannedOn: plan.plannedOn.toISOString(),
  };
}

// The plan again, as a create's data.
export function planFromSnapshot(snapshot: PlanSnapshot, businessId: string): Prisma.SavingsPlanUncheckedCreateInput {
  return {
    businessId,
    name: snapshot.name,
    category: snapshot.category,
    color: snapshot.color,
    amount: snapshot.amount,
    horizon: snapshot.horizon,
    needBy: day(snapshot.needBy),
    priority: snapshot.priority,
    note: snapshot.note,
    link: snapshot.link,
    plannedOn: new Date(snapshot.plannedOn),
  };
}

export function toGoalSnapshot(goal: SavingsGoal): GoalSnapshot {
  return {
    id: goal.id,
    name: goal.name,
    targetAmount: new Prisma.Decimal(goal.targetAmount).toFixed(2),
    targetDate: goal.targetDate.toISOString(),
    durationMonths: goal.durationMonths,
    reminderDate: iso(goal.reminderDate),
    reminderChannel: goal.reminderChannel,
    description: goal.description,
    status: goal.status,
    startAmount: new Prisma.Decimal(goal.startAmount).toFixed(2),
    planStartDate: iso(goal.planStartDate),
    planStartAmount: goal.planStartAmount === null ? null : new Prisma.Decimal(goal.planStartAmount).toFixed(2),
    reachedAt: iso(goal.reachedAt),
    monthlyReminder: goal.monthlyReminder,
    color: goal.color,
    accountId: goal.accountId,
    createdAt: goal.createdAt.toISOString(),
  };
}

// The goal again, with its own id and the day it was made. An account
// deleted since is left out (the goal picks one again).
export function goalFromSnapshot(snapshot: GoalSnapshot, businessId: string, accountStillThere: boolean): Prisma.SavingsGoalUncheckedCreateInput {
  return {
    id: snapshot.id,
    businessId,
    name: snapshot.name,
    targetAmount: snapshot.targetAmount,
    targetDate: new Date(snapshot.targetDate),
    durationMonths: snapshot.durationMonths,
    reminderDate: day(snapshot.reminderDate),
    reminderChannel: snapshot.reminderChannel,
    description: snapshot.description,
    status: snapshot.status,
    startAmount: snapshot.startAmount,
    planStartDate: day(snapshot.planStartDate),
    planStartAmount: snapshot.planStartAmount,
    reachedAt: day(snapshot.reachedAt),
    monthlyReminder: snapshot.monthlyReminder,
    color: snapshot.color,
    accountId: accountStillThere ? snapshot.accountId : null,
    createdAt: new Date(snapshot.createdAt),
  };
}

export const isPlanSnapshot = (value: Prisma.JsonValue | null): value is Prisma.JsonObject & PlanSnapshot =>
  !!value && typeof value === 'object' && !Array.isArray(value) && typeof (value as Record<string, unknown>).name === 'string' && typeof (value as Record<string, unknown>).plannedOn === 'string';

export const isGoalSnapshot = (value: Prisma.JsonValue | null): value is Prisma.JsonObject & GoalSnapshot =>
  !!value && typeof value === 'object' && !Array.isArray(value) && typeof (value as Record<string, unknown>).id === 'string' && typeof (value as Record<string, unknown>).targetDate === 'string';
