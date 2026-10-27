import { IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator';
import { whenSent } from '../../common/dto.js';

// Legal pages are long (the FAQ most of all); this only stops the absurd.
const MAX_CONTENT = 200_000;

// Content > Legal pages > Save draft. Without contentBn a new draft starts
// from the live Bangla text, so saving the English never drops it.
export class SaveLegalDraftDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_CONTENT)
  contentEn: string;

  // null (or an empty string) clears the Bangla.
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(MAX_CONTENT)
  contentBn?: string | null;
}

export class UpdateLegalDraftDto {
  @ValidateIf(whenSent)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_CONTENT)
  contentEn?: string;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(MAX_CONTENT)
  contentBn?: string | null;
}
