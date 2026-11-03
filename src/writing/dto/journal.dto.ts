import { JournalKind } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsNotEmpty, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { trim, whenSent } from '../../common/dto.js';
import { JOURNAL_BODY_MAX, JOURNAL_PROMPT_MAX, MOOD_MAX, MOOD_MIN } from '../writing-text.js';

export class JournalMonthQueryDto {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must be YYYY-MM' })
  month: string;
}

export class JournalSearchQueryDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  q: string;
}

// One day's entry, saved whole (the editor sends every field it shows).
export class SaveJournalEntryDto {
  @IsEnum(JournalKind)
  kind: JournalKind;

  @IsInt({ message: 'Pick a mood first' })
  @Min(MOOD_MIN)
  @Max(MOOD_MAX)
  mood: number;

  // The daily journal's prompts; a diary page leaves them out.
  @ValidateIf(whenSent)
  @IsString()
  @MaxLength(JOURNAL_PROMPT_MAX)
  wentWell?: string;

  @ValidateIf(whenSent)
  @IsString()
  @MaxLength(JOURNAL_PROMPT_MAX)
  gratefulFor?: string;

  @ValidateIf(whenSent)
  @IsString()
  @MaxLength(JOURNAL_PROMPT_MAX)
  tomorrow?: string;

  @ValidateIf(whenSent)
  @IsString()
  @MaxLength(JOURNAL_BODY_MAX)
  body?: string;

  @ValidateIf((dto: SaveJournalEntryDto) => dto.categoryId !== undefined && dto.categoryId !== null)
  @IsUUID()
  categoryId?: string | null;

  @ValidateIf(whenSent)
  @IsBoolean()
  isPrivate?: boolean;
}

// The diary PIN: four to six digits, like a workspace PIN.
const PIN = /^\d{4,6}$/;
const PIN_MESSAGE = 'The PIN is 4 to 6 digits';

export class SetDiaryPinDto {
  @Matches(PIN, { message: PIN_MESSAGE })
  pin: string;

  // Needed to replace a PIN already set ("Forgot PIN?" and "Change PIN"):
  // someone merely holding the signed-in device doesn't know it.
  @ValidateIf(whenSent)
  @IsString()
  @MaxLength(200)
  password?: string;
}

export class UnlockDiaryDto {
  @Matches(PIN, { message: PIN_MESSAGE })
  pin: string;
}
