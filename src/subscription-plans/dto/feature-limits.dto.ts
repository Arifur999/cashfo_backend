import { IsBoolean, IsInt, Min } from 'class-validator';

// Explicit shape for SubscriptionPlan.featureLimits -- keeps the admin from
// ever saving malformed/unexpected JSON into that column. -1 means
// "unlimited" on the three counts (the product convention used across the
// seed data -- the Business plan ships with maxBusinessWorkspaces: -1).
export class FeatureLimitsDto {
  @IsInt()
  @Min(-1)
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
