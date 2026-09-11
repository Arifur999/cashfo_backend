import { IsISO8601, IsOptional } from 'class-validator';

export class LoanStatementQueryDto {
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @IsOptional()
  @IsISO8601()
  dateTo?: string;
}
