import { IsDateString } from 'class-validator';

export class CloseSettlementDto {
  @IsDateString()
  periodStart: string;

  @IsDateString()
  periodEnd: string;
}
