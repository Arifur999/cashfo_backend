import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ContactCategoryQueryDto } from './contact-category-query.dto.js';

// `category` comes from ContactCategoryQueryDto.
export class DueSoonQueryDto extends ContactCategoryQueryDto {
  // How far ahead to look, today included; a week when left out.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  days?: number;
}
