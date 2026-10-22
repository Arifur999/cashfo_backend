import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

// The list's orders: biggest add-on first (the default), most workspaces,
// most extra workspaces, owner's name A to Z, plan name A to Z.
export const WORKSPACE_OVERVIEW_SORTS = ['addOn', 'workspaces', 'extra', 'name', 'plan'] as const;
export type WorkspaceOverviewSort = (typeof WORKSPACE_OVERVIEW_SORTS)[number];

export class ListWorkspaceOverviewQueryDto {
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
  @IsIn(WORKSPACE_OVERVIEW_SORTS)
  sort?: WorkspaceOverviewSort;
}
