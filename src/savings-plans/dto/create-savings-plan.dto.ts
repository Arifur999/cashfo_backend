import { SavingsPlanHorizon, SavingsPlanPriority } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsDateString, IsEnum, IsIn, IsNotEmpty, IsString, IsUrl, MaxLength, ValidateIf } from 'class-validator';
import { IsMoney, trim, whenSent } from '../../common/dto.js';
import { GOAL_COLORS, lowerColor } from '../../savings-goals/goal-colors.js';
import { SAVINGS_PLAN_CATEGORIES } from '../plan-math.js';

// A saving plan: what it is for, about how much, when it is needed and how
// important it is. Nothing is saved or taken from any account.
export class CreateSavingsPlanDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Write what you want to save for.' })
  @MaxLength(60)
  name: string;

  @ValidateIf(whenSent)
  @IsIn(SAVINGS_PLAN_CATEGORIES)
  category?: string;

  @Transform(lowerColor)
  @IsIn(GOAL_COLORS, { message: 'Pick one of the card colours' })
  color: string;

  @IsMoney()
  amount: number;

  @IsEnum(SavingsPlanHorizon)
  horizon: SavingsPlanHorizon;

  // The day it is needed by; only with BY_DATE, where it is required.
  @ValidateIf((dto: CreateSavingsPlanDto) => dto.horizon === 'BY_DATE' || dto.needBy !== undefined)
  @IsDateString({}, { message: 'Pick the date you need it by.' })
  needBy?: string;

  @ValidateIf(whenSent)
  @IsEnum(SavingsPlanPriority)
  priority?: SavingsPlanPriority;

  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  note?: string;

  // A product page or the like; empty clears it.
  @ValidateIf((dto: CreateSavingsPlanDto) => dto.link !== undefined && dto.link !== '')
  @Transform(trim)
  @IsUrl({ require_protocol: false }, { message: 'Enter a web address, like daraz.com.bd/…' })
  @MaxLength(500)
  link?: string;

  // The day it was planned: only when a deleted plan is put back (Undo), so
  // it keeps its own day. Left out, today.
  @ValidateIf(whenSent)
  @IsDateString()
  plannedOn?: string;
}
