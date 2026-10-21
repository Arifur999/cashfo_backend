import { IsISO8601, Matches, ValidateIf } from 'class-validator';
import { whenSent } from '../../common/dto.js';

// A calendar day, as the date pickers send it. IsISO8601 alone let through
// forms like 2026-W10 that `new Date()` can't read.
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// GET .../accounts/wallets-overview: with asOf (a Dhaka calendar day), every
// wallet also carries its balance at the end of that day.
export class WalletsOverviewQueryDto {
  @ValidateIf(whenSent)
  @Matches(DATE_ONLY, { message: 'asOf must be a date in YYYY-MM-DD form' })
  @IsISO8601({ strict: true })
  asOf?: string;
}
