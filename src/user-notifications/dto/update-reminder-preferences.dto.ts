import { IsBoolean, ValidateIf } from 'class-validator';
import { whenSent } from '../../common/dto.js';

// Settings > App > Reminders: every switch is sent each time.
export class UpdateReminderPreferencesDto {
  @IsBoolean()
  budget: boolean;

  @IsBoolean()
  loans: boolean;

  @IsBoolean()
  savings: boolean;

  // "Monthly summary by email"; left as it is when not sent.
  @ValidateIf(whenSent)
  @IsBoolean()
  monthlySummaryEmail?: boolean;
}
