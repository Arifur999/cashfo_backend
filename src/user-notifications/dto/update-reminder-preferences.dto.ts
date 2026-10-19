import { IsBoolean } from 'class-validator';

// Settings > App > Reminders: every switch is sent each time.
export class UpdateReminderPreferencesDto {
  @IsBoolean()
  budget: boolean;

  @IsBoolean()
  loans: boolean;

  @IsBoolean()
  savings: boolean;
}
