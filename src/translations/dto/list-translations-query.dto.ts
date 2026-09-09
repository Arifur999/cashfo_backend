import { IsOptional, IsString } from 'class-validator';

export class ListTranslationsQueryDto {
  @IsOptional()
  @IsString()
  context?: string;

  @IsOptional()
  @IsString()
  search?: string;
}
