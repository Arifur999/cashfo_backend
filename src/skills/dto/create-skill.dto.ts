import { SkillStatus, SkillUnit } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsNotEmpty, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { SKILL_COLORS, SKILL_ICONS } from '../skill-options.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

// Optional fields use ValidateIf(v !== undefined), not IsOptional: IsOptional
// also skips an explicit null, which would then reach the service as a value.
const whenSent = (_: unknown, value: unknown) => value !== undefined;

export class CreateSkillDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  source?: string;

  @IsEnum(SkillUnit)
  unit: SkillUnit;

  // Lessons, or MINUTES for HOURS (the service applies the per-unit maximum).
  @IsInt()
  @Min(1)
  @Max(60000)
  target: number;

  @ValidateIf(whenSent)
  @IsInt()
  @Min(0)
  @Max(60000)
  progress?: number;

  @ValidateIf(whenSent)
  @IsEnum(SkillStatus)
  status?: SkillStatus;

  @ValidateIf(whenSent)
  @IsIn(SKILL_COLORS)
  color?: string;

  @ValidateIf(whenSent)
  @IsIn(SKILL_ICONS)
  icon?: string;
}
