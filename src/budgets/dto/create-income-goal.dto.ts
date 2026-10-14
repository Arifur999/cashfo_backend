import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { IsMoney } from '../../common/dto.js';

export class CreateIncomeGoalDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year: number;

  @IsMoney()
  amount: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
