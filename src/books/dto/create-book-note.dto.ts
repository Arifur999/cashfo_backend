import { BookNoteKind } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEnum, IsIn, IsInt, IsString, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { MARK_COLORS } from '../book-colors.js';
import { whenSent } from '../../common/dto.js';
import { DAY } from './log-reading.dto.js';

export const NOTE_LINE_MAX = 600;
export const NOTE_TEXT_MAX = 3000;
export const MAX_MARKS = 100;

// One highlighted stretch of a note's text: character offsets [s, e) and a
// colour (the service checks they fall inside the text).
export class NoteMarkDto {
  @IsInt()
  @Min(0)
  @Max(NOTE_TEXT_MAX)
  s: number;

  @IsInt()
  @Min(1)
  @Max(NOTE_TEXT_MAX)
  e: number;

  @IsIn(MARK_COLORS)
  c: string;
}

// A note on a page of a book. The service settles what must be written: a
// thought needs its text; a highlight or an underline needs the line or the
// text.
export class CreateBookNoteDto {
  @IsInt()
  @Min(1)
  @Max(20000)
  page: number;

  // Today when left out; never a day still to come.
  @ValidateIf(whenSent)
  @Matches(DAY, { message: 'date must look like 2026-11-14' })
  date?: string;

  @ValidateIf(whenSent)
  @IsEnum(BookNoteKind)
  kind?: BookNoteKind;

  @ValidateIf(whenSent)
  @IsString()
  @MaxLength(NOTE_LINE_MAX + 100)
  line?: string;

  @ValidateIf(whenSent)
  @IsString()
  @MaxLength(NOTE_TEXT_MAX + 200)
  text?: string;

  // Highlights, when a deleted note is put back.
  @ValidateIf(whenSent)
  @IsArray()
  @ArrayMaxSize(MAX_MARKS)
  @ValidateNested({ each: true })
  @Type(() => NoteMarkDto)
  marks?: NoteMarkDto[];
}

// Every field optional; new text without new marks drops the old ones.
export class UpdateBookNoteDto {
  @ValidateIf(whenSent)
  @IsInt()
  @Min(1)
  @Max(20000)
  page?: number;

  @ValidateIf(whenSent)
  @Matches(DAY, { message: 'date must look like 2026-11-14' })
  date?: string;

  @ValidateIf(whenSent)
  @IsEnum(BookNoteKind)
  kind?: BookNoteKind;

  @ValidateIf(whenSent)
  @IsString()
  @MaxLength(NOTE_LINE_MAX + 100)
  line?: string;

  @ValidateIf(whenSent)
  @IsString()
  @MaxLength(NOTE_TEXT_MAX + 200)
  text?: string;

  @ValidateIf(whenSent)
  @IsArray()
  @ArrayMaxSize(MAX_MARKS)
  @ValidateNested({ each: true })
  @Type(() => NoteMarkDto)
  marks?: NoteMarkDto[];
}
