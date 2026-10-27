import { IsIn, ValidateIf } from 'class-validator';
import { whenSent } from '../../common/dto.js';
import { DASHBOARD_PERIODS, type DashboardPeriod } from '../dashboard-maths.js';

// GET /admin/dashboard/summary?period=7d|30d|90d (default 30d): the span of
// the sign-ups chart and of users.newInPeriod.
export class DashboardQueryDto {
  @ValidateIf(whenSent)
  @IsIn(DASHBOARD_PERIODS)
  period?: DashboardPeriod;
}
