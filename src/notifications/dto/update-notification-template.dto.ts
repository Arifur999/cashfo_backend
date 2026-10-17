import { IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';

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

  // The template's On switch: an off template can't be sent.
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
