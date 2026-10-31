import { IsDateString, IsIn, ValidateIf } from 'class-validator';

// Catch up on a goal behind its plan. RESET: save what is needed each month
// from today to the same end date (with a reminder email on the 1st).
// EXTEND: a later end date, at the goal's original monthly pace. Both start
// a fresh plan line from today.
export class UpdateSavingsPlanDto {
  @IsIn(['RESET', 'EXTEND'])
  mode: 'RESET' | 'EXTEND';

  @ValidateIf((dto: UpdateSavingsPlanDto) => dto.mode === 'EXTEND')
  @IsDateString()
  targetDate?: string;
}
