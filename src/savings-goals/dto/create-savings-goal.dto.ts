import { SavingsReminderChannel } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsNotEmpty, IsOptional, IsPositive, IsString, Max, ValidateIf } from 'class-validator';
import { IsMoney, whenSent } from '../../common/dto.js';

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

  // Money already saved for this goal before it was made, and the savings
  // wallet that holds it: recorded as the goal's first contribution.
  @ValidateIf(whenSent)
  @IsMoney()
  startAmount?: number;

  @ValidateIf((dto: CreateSavingsGoalDto) => (dto.startAmount ?? 0) > 0)
  @IsString()
  @IsNotEmpty()
  startAccountId?: string;
}
