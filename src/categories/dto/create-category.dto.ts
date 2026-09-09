import { IsBoolean, IsEnum, IsInt, IsOptional, IsString } from 'class-validator';
import { CategoryDirection } from '@prisma/client';

export class CreateCategoryDto {
  @IsString()
  name: string;

  @IsString()
  nameBn: string;

  @IsEnum(CategoryDirection)
  type: CategoryDirection;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @IsString()
  linkedAccountTemplateId?: string;

  @IsOptional()
  @IsInt()
  displayOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
