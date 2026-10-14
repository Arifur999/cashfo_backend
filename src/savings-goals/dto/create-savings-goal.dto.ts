import { SavingsReminderChannel } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsNotEmpty, IsOptional, IsPositive, IsString, Max } from 'class-validator';
import { IsMoney } from '../../common/dto.js';

export class CreateSavingsGoalDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsMoney()
  targetAmount: number;

  @IsDateString()
  targetDate: string;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @Max(1200)
  durationMonths: number;

  @IsOptional()
  @IsDateString()
  reminderDate?: string;

  @IsOptional()
  @IsEnum(SavingsReminderChannel)
  reminderChannel?: SavingsReminderChannel;

  @IsOptional()
  @IsString()
  description?: string;
}
