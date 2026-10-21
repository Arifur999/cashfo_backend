import { IsISO8601, Matches, ValidateIf } from 'class-validator';
import { whenSent } from '../../common/dto.js';

// Calendar days, as the date pickers send them. IsISO8601 alone let through
// forms like 2026-W10 that `new Date()` can't read.
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = 'must be a date in YYYY-MM-DD form';

// GET .../accounts: with either day (Dhaka calendar days, both included),
// every account also carries what moved through it in that period.
export class ListAccountsQueryDto {
  @ValidateIf(whenSent)
  @Matches(DATE_ONLY, { message: `dateFrom ${DATE_MESSAGE}` })
  @IsISO8601({ strict: true })
  dateFrom?: string;

  @ValidateIf(whenSent)
  @Matches(DATE_ONLY, { message: `dateTo ${DATE_MESSAGE}` })
  @IsISO8601({ strict: true })
  dateTo?: string;
}
