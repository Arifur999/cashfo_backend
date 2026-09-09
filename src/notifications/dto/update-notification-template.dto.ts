import { IsArray, IsOptional, IsString } from 'class-validator';

export class UpdateNotificationTemplateDto {
  @IsOptional()
  @IsString()
  subjectEn?: string;

  @IsOptional()
  @IsString()
  subjectBn?: string;

  @IsOptional()
  @IsString()
  bodyEn?: string;

  @IsOptional()
  @IsString()
  bodyBn?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  variables?: string[];
}
