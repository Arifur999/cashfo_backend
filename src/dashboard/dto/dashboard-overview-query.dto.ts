import { IsISO8601, Matches } from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// GET /admin/dashboard/overview?from=YYYY-MM-DD&to=YYYY-MM-DD: the period
// the "Choose period" picker shows, as Dhaka calendar days. A whole month
// or year is sent from its first to its last day, even while it runs.
export class DashboardOverviewQueryDto {
  @Matches(DATE_ONLY, { message: 'from must be a date in YYYY-MM-DD form' })
  @IsISO8601({ strict: true })
  from!: string;

  @Matches(DATE_ONLY, { message: 'to must be a date in YYYY-MM-DD form' })
  @IsISO8601({ strict: true })
  to!: string;
}
