import { IsEnum, IsOptional } from 'class-validator';
import { CategoryDirection } from '@prisma/client';

export class ListCategoriesQueryDto {
  @IsOptional()
  @IsEnum(CategoryDirection)
  type?: CategoryDirection;
}
