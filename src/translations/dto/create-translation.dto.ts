import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class CreateTranslationDto {
  // "dashboard.total_income": lowercase words (joined by single
  // underscores) separated by dots. No leading underscore, so "__proto__"
  // can't be spelled; the service also refuses "constructor"/"prototype".
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  @Matches(/^[a-z0-9]+(?:_[a-z0-9]+)*(?:\.[a-z0-9]+(?:_[a-z0-9]+)*)*$/, { message: 'key must be lowercase words joined by dots, e.g. dashboard.total_income' })
  key: string;

  @IsString()
  en: string;

  @IsString()
  bn: string;

  @IsOptional()
  @IsString()
  context?: string;
}
