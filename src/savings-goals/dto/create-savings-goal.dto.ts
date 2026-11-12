import { SavingsReminderChannel } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsDateString, IsEnum, IsIn, IsInt, IsNotEmpty, IsOptional, IsPositive, IsString, Max, ValidateIf } from 'class-validator';
import { IsMoney, whenSent } from '../../common/dto.js';
import { GOAL_COLORS, lowerColor } from '../goal-colors.js';

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

  // The savings account the goal keeps its money in: every deposit goes
  // here ("Keep the money in").
  @ValidateIf(whenSent)
  @IsString()
  @IsNotEmpty()
  accountId?: string;

  // Money already saved for this goal before it was made, and the savings
  // wallet that holds it (the goal's own account unless named):
  // recorded as the goal's first contribution.
  @ValidateIf(whenSent)
  @IsMoney()
  startAmount?: number;

  @ValidateIf((dto: CreateSavingsGoalDto) => (dto.startAmount ?? 0) > 0 && !dto.accountId)
  @IsString()
  @IsNotEmpty()
  startAccountId?: string;

  // Its card colour, one of GOAL_COLORS. Left out, the page draws it in the
  // colour its place in the list gives it.
  @ValidateIf(whenSent)
  @Transform(lowerColor)
  @IsIn(GOAL_COLORS, { message: 'Pick one of the card colours' })
  color?: string;

  // Start goal on a saving plan: the plan is removed in the same database
  // transaction the goal is made in.
  @ValidateIf(whenSent)
  @IsString()
  @IsNotEmpty()
  fromPlanId?: string;
}
