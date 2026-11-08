import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { normalizeEmail, trim, whenSent } from '../../common/dto.js';
import { VIDEO_CATEGORIES, WEEK_DAYS } from '../help-rules.js';

// Admin › Settings › Company and help page. Send what changes.
export class UpdateHelpCompanyDto {
  @ValidateIf(whenSent) @Transform(trim) @IsString() @MaxLength(60) name?: string;
  @ValidateIf(whenSent) @Transform(trim) @IsString() @MaxLength(120) tagline?: string;
  @ValidateIf(whenSent) @Transform(trim) @IsString() @MaxLength(120) taglineBn?: string;
  @ValidateIf(whenSent) @Transform(trim) @IsString() @MaxLength(120) legalName?: string;
  @ValidateIf(whenSent) @Transform(trim) @IsString() @MaxLength(60) tradeLicence?: string;
  @ValidateIf(whenSent) @Transform(trim) @IsString() @MaxLength(30) hotline?: string;
  @ValidateIf(whenSent) @Transform(trim) @IsString() @MaxLength(30) whatsapp?: string;
  // The platform's one support email (General's too); empty is refused, as there.
  @ValidateIf(whenSent) @Transform(normalizeEmail) @IsEmail() @MaxLength(120) email?: string;
  @ValidateIf(whenSent) @Transform(trim) @IsString() @MaxLength(200) website?: string;
  @ValidateIf(whenSent) @Transform(trim) @IsString() @MaxLength(200) facebook?: string;
  @ValidateIf(whenSent) @Transform(trim) @IsString() @MaxLength(200) youtube?: string;
  @ValidateIf(whenSent) @Transform(trim) @IsString() @MaxLength(200) headOffice?: string;
  @ValidateIf(whenSent) @Transform(trim) @IsString() @MaxLength(200) dhakaOffice?: string;

  @ValidateIf(whenSent)
  @IsArray()
  @ArrayMaxSize(7)
  @IsIn(WEEK_DAYS, { each: true })
  openDays?: (typeof WEEK_DAYS)[number][];

  @ValidateIf(whenSent) @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) opensAt?: string;
  @ValidateIf(whenSent) @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) closesAt?: string;

  @ValidateIf(whenSent) @IsInt() @Min(0) @Max(168) replyHours?: number;
}

export class HelpVideoDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(120) titleEn: string;
  @ValidateIf(whenSent) @Transform(trim) @IsString() @MaxLength(120) titleBn?: string;
  @IsIn(VIDEO_CATEGORIES) category: (typeof VIDEO_CATEGORIES)[number];
  @IsInt() @Min(1) @Max(180) minutes: number;
  // Any YouTube link (watch, youtu.be, shorts, embed) or the bare id.
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(300) youtube: string;
  @ValidateIf(whenSent) @IsBoolean() shown?: boolean;
}

export class UpdateHelpVideoDto {
  @ValidateIf(whenSent) @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(120) titleEn?: string;
  @ValidateIf(whenSent) @Transform(trim) @IsString() @MaxLength(120) titleBn?: string;
  @ValidateIf(whenSent) @IsIn(VIDEO_CATEGORIES) category?: (typeof VIDEO_CATEGORIES)[number];
  @ValidateIf(whenSent) @IsInt() @Min(1) @Max(180) minutes?: number;
  @ValidateIf(whenSent) @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(300) youtube?: string;
  @ValidateIf(whenSent) @IsBoolean() shown?: boolean;
}

export class OrderHelpVideosDto {
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  ids: string[];
}
