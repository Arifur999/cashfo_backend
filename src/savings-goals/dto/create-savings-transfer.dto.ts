import { IsDateString, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { IsMoney } from '../../common/dto.js';

export class CreateSavingsTransferDto {
  @IsString()
  @IsNotEmpty()
  fromGoalId: string;

  @IsString()
  @IsNotEmpty()
  toGoalId: string;

  @IsMoney()
  amount: number;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
