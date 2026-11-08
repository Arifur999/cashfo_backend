import { SkillStatus, SkillUnit } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsInt, IsNotEmpty, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { SKILL_CATEGORIES, SKILL_COLORS, SKILL_ICONS, SKILL_LIMITS } from '../skill-options.js';
import { trim, whenSent } from '../../common/dto.js';
import { DAY } from './create-skill.dto.js';

// Every field is optional -- the same route edits the details and moves a
// skill between shelves (status, paused). The unit can change only while no
// practice is logged (12 lessons would become 12 minutes).
export class UpdateSkillDto {
  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(SKILL_LIMITS.name)
  name?: string;

  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @MaxLength(SKILL_LIMITS.source)
  source?: string;

  @ValidateIf(whenSent)
  @IsEnum(SkillUnit)
  unit?: SkillUnit;

  @ValidateIf(whenSent)
  @IsInt()
  @Min(1)
  @Max(SKILL_LIMITS.minutes)
  target?: number;

  @ValidateIf(whenSent)
  @IsInt()
  @Min(0)
  @Max(SKILL_LIMITS.minutes)
  base?: number;

  // The older way to say where the skill is (lesson 8): it moves `base` so
  // the progress lands there.
  @ValidateIf(whenSent)
  @IsInt()
  @Min(0)
  @Max(SKILL_LIMITS.minutes)
  progress?: number;

  @ValidateIf(whenSent)
  @IsEnum(SkillStatus)
  status?: SkillStatus;

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

  // null clears it.
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @Matches(DAY, { message: 'targetDate must look like 2026-12-31' })
  targetDate?: string | null;
}
