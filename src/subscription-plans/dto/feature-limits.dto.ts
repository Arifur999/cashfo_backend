import { IsBoolean, IsInt, Min } from 'class-validator';

// Explicit shape for SubscriptionPlan.featureLimits -- keeps the admin from
// ever saving malformed/unexpected JSON into that column. -1 on the
// transaction-count field means "unlimited" (matches the product convention
// used across the seed data).
export class FeatureLimitsDto {
  @IsInt()
  @Min(0)
  maxWorkspaces: number;

  @IsInt()
  @Min(0)
  maxBusinessWorkspaces: number;

  @IsInt()
  @Min(-1)
  maxTransactionsPerMonth: number;

  @IsBoolean()
  advancedReports: boolean;

  @IsBoolean()
  pdfExport: boolean;

  @IsBoolean()
  multiUser: boolean;

  @IsBoolean()
  incomeGoalTracking: boolean;
}
