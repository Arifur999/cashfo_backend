// A plan's limits as stored in SubscriptionPlan.featureLimits (free-form
// JSON). -1 or a missing number means "no limit".
export interface PlanLimits {
  transactionLimit: number;
  workspaceLimit: number;
  pdfExport: boolean;
}

const limitOf = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : -1);

export function planLimits(featureLimits: unknown): PlanLimits {
  const limits = featureLimits && typeof featureLimits === 'object' ? (featureLimits as Record<string, unknown>) : {};
  return {
    transactionLimit: limitOf(limits.maxTransactionsPerMonth),
    workspaceLimit: limitOf(limits.maxWorkspaces),
    pdfExport: limits.pdfExport === true,
  };
}

// How many of a limit are left (null when there is no limit), never below 0.
export const leftOf = (used: number, limit: number): number | null => (limit < 0 ? null : Math.max(0, limit - used));
