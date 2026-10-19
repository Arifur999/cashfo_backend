import { IsBoolean, IsDateString, IsOptional } from 'class-validator';

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
}
