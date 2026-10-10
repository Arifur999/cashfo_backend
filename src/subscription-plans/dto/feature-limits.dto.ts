import { IsBoolean, IsInt, Min } from 'class-validator';

// Explicit shape for SubscriptionPlan.featureLimits -- keeps the admin from
// ever saving malformed/unexpected JSON into that column. -1 means
// "unlimited" on the transaction-count and business-workspace fields
// (matches the product convention used across the seed data -- the Business
// plan ships with maxBusinessWorkspaces: -1, which @Min(0) used to reject,
// so that plan couldn't be edited at all).
export class FeatureLimitsDto {
  @IsInt()
  @Min(0)
  maxWorkspaces: number;

  @IsInt()
  @Min(-1)
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
