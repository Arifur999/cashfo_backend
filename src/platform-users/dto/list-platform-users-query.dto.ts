import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { PlatformUserStatus } from '@prisma/client';

const SORTABLE_FIELDS = ['createdAt', 'name', 'email', 'lastLoginAt'] as const;

export class ListPlatformUsersQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(Object.values(PlatformUserStatus))
  status?: PlatformUserStatus;

  @IsOptional()
  @IsString()
  planId?: string;

  // Leading "-" means descending, e.g. "-createdAt". Defaults to "-createdAt"
  // (newest first) in the service when omitted.
  @IsOptional()
  @IsString()
  sortBy?: string;

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

export { SORTABLE_FIELDS };
