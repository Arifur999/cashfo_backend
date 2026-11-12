import { SavingsReminderChannel } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsDateString, IsEnum, IsIn, IsInt, IsNotEmpty, IsOptional, IsPositive, IsString, Max, ValidateIf } from 'class-validator';
import { IsMoney, whenSent } from '../../common/dto.js';
import { GOAL_COLORS, lowerColor } from '../goal-colors.js';

// No status here -- that goes through the dedicated status endpoint (Pause/
// Resume/Complete), same split as ContactsService's update()/archive().
// Name, target and duration can't be cleared, so an explicit null is
// validated (and refused) rather than stored; the reminder may be cleared.
export class UpdateSavingsGoalDto {
  @ValidateIf(whenSent)
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ValidateIf(whenSent)
  @IsMoney()
  targetAmount?: number;

  @ValidateIf(whenSent)
  @IsDateString()
  targetDate?: string;

  @ValidateIf(whenSent)
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @Max(1200)
  durationMonths?: number;

  @IsOptional()
  @IsDateString()
  reminderDate?: string | null;

  @IsOptional()
  @IsEnum(SavingsReminderChannel)
  reminderChannel?: SavingsReminderChannel;

  @IsOptional()
  @IsString()
  description?: string;

  // Another savings account to keep the money in: the next deposits go
  // there, and what is saved moves there too.
  @ValidateIf(whenSent)
  @IsString()
  @IsNotEmpty()
  accountId?: string;

  // Its card colour, one of GOAL_COLORS.
  @ValidateIf(whenSent)
  @Transform(lowerColor)
  @IsIn(GOAL_COLORS, { message: 'Pick one of the card colours' })
  color?: string;
}
