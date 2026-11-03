import { NoteKind } from '@prisma/client';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsIn, IsNotEmpty, IsString, IsUUID, Matches, MaxLength, ValidateIf } from 'class-validator';
import { trim, whenSent } from '../../common/dto.js';
import { CATEGORY_COLORS, CATEGORY_NAME_MAX, NOTE_BODY_MAX, NOTE_COLORS, NOTE_TITLE_MAX, normalizeTag, TAG_PATTERN, TAGS_PER_NOTE } from '../writing-text.js';

const tags = ({ value }: { value: unknown }) => (Array.isArray(value) ? value.map((tag) => (typeof tag === 'string' ? normalizeTag(tag) : tag)) : value);

export class CreateNoteDto {
  @ValidateIf(whenSent)
  @IsEnum(NoteKind)
  kind?: NoteKind;

  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @MaxLength(NOTE_TITLE_MAX)
  title?: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Write something first' })
  @MaxLength(NOTE_BODY_MAX)
  body: string;

  // null: no category.
  @ValidateIf((dto: CreateNoteDto) => dto.categoryId !== undefined && dto.categoryId !== null)
  @IsUUID()
  categoryId?: string | null;

  @ValidateIf(whenSent)
  @Transform(tags)
  @IsArray()
  @ArrayMaxSize(TAGS_PER_NOTE, { message: `A note can have up to ${TAGS_PER_NOTE} tags` })
  @IsString({ each: true })
  @Matches(TAG_PATTERN, { each: true, message: 'A tag is one word: letters, digits, _ or -, up to 30 of them' })
  tags?: string[];

  @ValidateIf(whenSent)
  @IsIn(NOTE_COLORS)
  color?: string;

  @ValidateIf(whenSent)
  @IsBoolean()
  pinned?: boolean;
}

export class UpdateNoteDto {
  @ValidateIf(whenSent)
  @IsEnum(NoteKind)
  kind?: NoteKind;

  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @MaxLength(NOTE_TITLE_MAX)
  title?: string;

  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Write something first' })
  @MaxLength(NOTE_BODY_MAX)
  body?: string;

  @ValidateIf((dto: UpdateNoteDto) => dto.categoryId !== undefined && dto.categoryId !== null)
  @IsUUID()
  categoryId?: string | null;

  @ValidateIf(whenSent)
  @Transform(tags)
  @IsArray()
  @ArrayMaxSize(TAGS_PER_NOTE, { message: `A note can have up to ${TAGS_PER_NOTE} tags` })
  @IsString({ each: true })
  @Matches(TAG_PATTERN, { each: true, message: 'A tag is one word: letters, digits, _ or -, up to 30 of them' })
  tags?: string[];

  @ValidateIf(whenSent)
  @IsIn(NOTE_COLORS)
  color?: string;

  @ValidateIf(whenSent)
  @IsBoolean()
  pinned?: boolean;

  @ValidateIf(whenSent)
  @IsBoolean()
  archived?: boolean;
}

export class CreateNoteCategoryDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Give the category a name' })
  @MaxLength(CATEGORY_NAME_MAX)
  name: string;

  // Left out: the next colour in the palette.
  @ValidateIf(whenSent)
  @IsIn(CATEGORY_COLORS)
  color?: string;
}

export class UpdateNoteCategoryDto {
  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Give the category a name' })
  @MaxLength(CATEGORY_NAME_MAX)
  name?: string;

  @ValidateIf(whenSent)
  @IsIn(CATEGORY_COLORS)
  color?: string;
}
