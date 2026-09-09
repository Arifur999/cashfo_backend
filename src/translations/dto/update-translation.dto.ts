import { IsOptional, IsString } from 'class-validator';

export class UpdateTranslationDto {
  @IsOptional()
  @IsString()
  en?: string;

  @IsOptional()
  @IsString()
  bn?: string;

  @IsOptional()
  @IsString()
  context?: string;
}
