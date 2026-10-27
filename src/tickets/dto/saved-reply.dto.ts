import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator';
import { trim, whenSent } from '../../common/dto.js';

// A canned answer the support team picks from under the reply box. The
// Bangla body is optional: without it the English one is used.
export class CreateSavedReplyDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  bodyEn: string;

  // null (or an empty string) clears it.
  @Transform(trim)
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(5000)
  bodyBn?: string | null;
}

export class UpdateSavedReplyDto {
  @Transform(trim)
  @ValidateIf(whenSent)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title?: string;

  @Transform(trim)
  @ValidateIf(whenSent)
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  bodyEn?: string;

  @Transform(trim)
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(5000)
  bodyBn?: string | null;
}
