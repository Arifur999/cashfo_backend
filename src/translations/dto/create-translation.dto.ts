import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateTranslationDto {
  @IsString()
  @IsNotEmpty()
  key: string;

  @IsString()
  en: string;

  @IsString()
  bn: string;

  @IsOptional()
  @IsString()
  context?: string;
}
