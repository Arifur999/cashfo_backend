import { Type } from 'class-transformer';
import { ContactCategory, ContactStatus, ContactType } from '@prisma/client';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ListContactsQueryDto {
  @IsOptional()
  @IsIn(Object.values(ContactType))
  type?: ContactType;

  @IsOptional()
  @IsIn(Object.values(ContactCategory))
  category?: ContactCategory;

  @IsOptional()
  @IsIn(Object.values(ContactStatus))
  status?: ContactStatus;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
