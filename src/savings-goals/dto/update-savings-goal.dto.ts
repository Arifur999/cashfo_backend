import { SavingsReminderChannel } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsNotEmpty, IsOptional, IsPositive, IsString, Max, ValidateIf } from 'class-validator';
import { IsMoney, whenSent } from '../../common/dto.js';

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
}
