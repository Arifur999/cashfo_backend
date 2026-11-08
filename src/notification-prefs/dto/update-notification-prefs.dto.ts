import { IsIn, IsObject, Matches, ValidateIf } from 'class-validator';
import { whenSent } from '../../common/dto.js';
import { EVENT_DAYS, LOAN_DAYS, WEEK_DAYS } from '../notification-prefs.js';

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

// What is sent changes; resolvePrefs() keeps only alerts and channels it
// knows, and the security alerts' locked channels on.
export class UpdateNotificationPrefsDto {
  // { budget: { push: false }, ... }
  @ValidateIf(whenSent)
  @IsObject()
  alerts?: Record<string, Record<string, boolean>>;

  @ValidateIf(whenSent)
  @IsIn([...LOAN_DAYS])
  loanDaysBefore?: number;

  @ValidateIf(whenSent)
  @IsIn([...EVENT_DAYS])
  eventDaysBefore?: number;

  @ValidateIf(whenSent)
  @IsIn([true, false])
  quietOn?: boolean;

  @ValidateIf(whenSent)
  @Matches(CLOCK)
  quietFrom?: string;

  @ValidateIf(whenSent)
  @Matches(CLOCK)
  quietTo?: string;

  @ValidateIf(whenSent)
  @IsIn(['off', 'daily', 'weekly'])
  summaryMode?: 'off' | 'daily' | 'weekly';

  @ValidateIf(whenSent)
  @IsIn([...WEEK_DAYS])
  summaryDay?: (typeof WEEK_DAYS)[number];

  @ValidateIf(whenSent)
  @Matches(CLOCK)
  summaryTime?: string;

  // Back to how Smartly set them at the start.
  @ValidateIf(whenSent)
  @IsIn([true])
  reset?: true;
}
