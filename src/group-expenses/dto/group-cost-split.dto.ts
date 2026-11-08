import { GroupCostSplit } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEnum, IsNumber, IsString, Max, Min, ValidateIf, ValidateNested } from 'class-validator';
import { whenSent } from '../../common/dto.js';

export class GroupCostPercentDto {
  @IsString()
  groupMemberId: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  percent: number;
}

// Members > Cost split: everyone the same, or a percent for each active
// member adding up to 100.
export class GroupCostSplitDto {
  @IsEnum(GroupCostSplit)
  mode: GroupCostSplit;

  @ValidateIf(whenSent)
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => GroupCostPercentDto)
  members?: GroupCostPercentDto[];
}
