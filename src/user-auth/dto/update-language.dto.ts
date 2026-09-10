import { IsEnum } from 'class-validator';
import { LanguagePreference } from '@prisma/client';

export class UpdateLanguageDto {
  @IsEnum(LanguagePreference)
  preferredLanguage: LanguagePreference;
}
