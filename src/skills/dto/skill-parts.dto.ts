import { SkillResourceKind } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsInt, IsNotEmpty, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { SKILL_LIMITS } from '../skill-options.js';
import { trim, whenSent } from '../../common/dto.js';
import { DAY } from './create-skill.dto.js';

// One day's practice (PUT :id/practice/:date): how much (lessons or
// chapters, or MINUTES for an hours skill) and what was learned.
export class LogPracticeDto {
  @IsInt()
  @Min(1)
  @Max(SKILL_LIMITS.minutes)
  amount: number;

  @ValidateIf(whenSent)
  @IsString()
  @MaxLength(SKILL_LIMITS.practiceNote + 100)
  note?: string;

  // At the end of the skill: mark it completed too (the board's checkbox).
  @ValidateIf(whenSent)
  @IsBoolean()
  finish?: boolean;
}

export class PracticeRangeQueryDto {
  @Matches(DAY, { message: 'from must look like 2026-11-14' })
  from: string;

  @Matches(DAY, { message: 'to must look like 2026-11-14' })
  to: string;
}

export class CreateSkillStepDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(SKILL_LIMITS.stepTitle)
  title: string;

  // Where it goes (from 0); the end when left out. A deleted step put back
  // comes back where it was, ticked as it was.
  @ValidateIf(whenSent)
  @IsInt()
  @Min(0)
  @Max(SKILL_LIMITS.steps)
  position?: number;

  @ValidateIf(whenSent)
  @IsBoolean()
  done?: boolean;

  @ValidateIf(whenSent)
  @Matches(DAY, { message: 'doneOn must look like 2026-11-14' })
  doneOn?: string;
}

export class UpdateSkillStepDto {
  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(SKILL_LIMITS.stepTitle)
  title?: string;

  @ValidateIf(whenSent)
  @IsBoolean()
  done?: boolean;
}

export class MoveSkillStepDto {
  @IsIn(['up', 'down'])
  direction: 'up' | 'down';
}

export class CreateSkillNoteDto {
  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @MaxLength(SKILL_LIMITS.noteTitle)
  title?: string;

  @IsString()
  @MaxLength(SKILL_LIMITS.noteText + 200)
  text: string;

  // Today when left out (a deleted note put back keeps its day).
  @ValidateIf(whenSent)
  @Matches(DAY, { message: 'date must look like 2026-11-14' })
  date?: string;
}

export class UpdateSkillNoteDto {
  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @MaxLength(SKILL_LIMITS.noteTitle)
  title?: string;

  @ValidateIf(whenSent)
  @Matches(DAY, { message: 'date must look like 2026-11-14' })
  date?: string;

  @ValidateIf(whenSent)
  @IsString()
  @MaxLength(SKILL_LIMITS.noteText + 200)
  text?: string;
}

export class CreateSkillResourceDto {
  @IsEnum(SkillResourceKind)
  kind: SkillResourceKind;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(SKILL_LIMITS.resourceTitle)
  title: string;

  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @MaxLength(SKILL_LIMITS.link)
  url?: string;
}

export class UpdateSkillResourceDto {
  @ValidateIf(whenSent)
  @IsEnum(SkillResourceKind)
  kind?: SkillResourceKind;

  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(SKILL_LIMITS.resourceTitle)
  title?: string;

  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @MaxLength(SKILL_LIMITS.link)
  url?: string;
}
