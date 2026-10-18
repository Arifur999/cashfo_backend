import { Type } from 'class-transformer';
import { UserStatus } from '@prisma/client';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { TIME_WINDOWS, type TimeWindow } from '../../common/time-window.js';
import {
  LAST_ACTIVE_FILTERS,
  type LastActiveFilter,
  OWNER_SORTS,
  type OwnerSort,
  WORKSPACE_COUNT_FILTERS,
  type WorkspaceCountFilter,
} from '../owner-filters.js';

export class ListOwnersQueryDto {
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

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @IsOptional()
  @IsString()
  planId?: string;

  @IsOptional()
  @IsIn(TIME_WINDOWS)
  joined?: TimeWindow;

  @IsOptional()
  @IsIn(LAST_ACTIVE_FILTERS)
  lastActive?: LastActiveFilter;

  @IsOptional()
  @IsIn(WORKSPACE_COUNT_FILTERS)
  workspaces?: WorkspaceCountFilter;

  @IsOptional()
  @IsIn(OWNER_SORTS)
  sort?: OwnerSort;
}
