import { IsBoolean, IsDateString, IsOptional, ValidateIf } from 'class-validator';
import { IsMoney, whenSent } from '../../common/dto.js';

export class CloseSettlementDto {
  @IsDateString()
  periodStart: string;

  @IsDateString()
  periodEnd: string;

  // Carry each balance into the next month, as a CARRY contribution dated
  // the day after the period.
  @IsOptional()
  @IsBoolean()
  carryForward?: boolean;

  // The next month's budget, set while closing ("Create November and close
  // October"); left out, nothing is set.
  @ValidateIf(whenSent)
  @IsMoney()
  nextBudgetAmount?: number;
}
