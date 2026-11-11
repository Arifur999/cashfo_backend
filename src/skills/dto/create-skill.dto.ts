import { SkillStatus, SkillUnit } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsInt, IsNotEmpty, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { SKILL_CATEGORIES, SKILL_COLORS, SKILL_ICONS, SKILL_LIMITS } from '../skill-options.js';
import { trim, whenSent } from '../../common/dto.js';

export const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export class CreateSkillDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(SKILL_LIMITS.name)
  name: string;

  // Where it is learned ("Udemy", "a teacher").
  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @MaxLength(SKILL_LIMITS.source)
  source?: string;

  @IsEnum(SkillUnit)
  unit: SkillUnit;

  // Lessons or chapters, or MINUTES for HOURS (the service applies the per-unit maximum).
  @IsInt()
  @Min(1)
  @Max(SKILL_LIMITS.minutes)
  target: number;

  // "Already done": ground covered before it was tracked here, in the unit.
  @ValidateIf(whenSent)
  @IsInt()
  @Min(0)
  @Max(SKILL_LIMITS.minutes)
  base?: number;

  // The older name of `base` (the progress a new skill starts at).
  @ValidateIf(whenSent)
  @IsInt()
  @Min(0)
  @Max(SKILL_LIMITS.minutes)
  progress?: number;

  @ValidateIf(whenSent)
  @IsEnum(SkillStatus)
  status?: SkillStatus;

  // Learning, but put down for now (the board's "Paused").
  @ValidateIf(whenSent)
  @IsBoolean()
  paused?: boolean;

  @ValidateIf(whenSent)
  @IsIn(SKILL_COLORS)
  color?: string;

  @ValidateIf(whenSent)
  @IsIn(SKILL_ICONS)
  icon?: string;

  @ValidateIf(whenSent)
  @IsIn(SKILL_CATEGORIES)
  category?: string;

  // http(s) only; the service checks the shape.
  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @MaxLength(SKILL_LIMITS.link)
  link?: string;

  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @MaxLength(SKILL_LIMITS.why)
  why?: string;

  // The day it should be done by; null for none.
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @Matches(DAY, { message: 'targetDate must look like 2026-12-31' })
  targetDate?: string | null;
}
