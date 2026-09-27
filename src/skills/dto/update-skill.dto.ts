import { SkillStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsNotEmpty, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { SKILL_COLORS, SKILL_ICONS } from '../skill-options.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

// ValidateIf(v !== undefined), not IsOptional: IsOptional also skips an
// explicit null, which would then reach the service as a value.
const whenSent = (_: unknown, value: unknown) => value !== undefined;

// Every field is optional -- the same route edits the details, records
// progress and moves a skill between shelves (status). The unit is fixed at
// creation (changing it would turn 12 lessons into 12 minutes), so it is not
// accepted here.
export class UpdateSkillDto {
  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  source?: string;

  @ValidateIf(whenSent)
  @IsInt()
  @Min(1)
  @Max(60000)
  target?: number;

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
