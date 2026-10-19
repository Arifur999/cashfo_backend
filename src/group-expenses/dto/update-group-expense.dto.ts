import { GroupPaidFrom, GroupSplit } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDateString, IsEnum, IsNumberString, IsOptional, IsString, ValidateNested } from 'class-validator';
import { GroupExpenseSplitDto } from './group-expense-split.dto.js';

export class UpdateGroupExpenseDto {
  @IsOptional()
  @IsNumberString()
  amount?: string;

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  description?: string;

  // Empty string clears it (no one tracked) -- undefined leaves it unchanged,
  // same "explicit empty vs omitted" convention as ContactsService.update()'s
  // photoUrl.
  @IsOptional()
  @IsString()
  paidByMemberId?: string;

  // FUND: paid from the group's cash. MEMBER: paidByMemberId paid it from
  // their own pocket, and is credited for it.
  @IsOptional()
  @IsEnum(GroupPaidFrom)
  paidFrom?: GroupPaidFrom;

  // How it is shared. Left out on a new expense, its category's default.
  @IsOptional()
  @IsEnum(GroupSplit)
  split?: GroupSplit;

  // The members it names (none: everyone in the group that day). Sent on an
  // edit, it replaces the ones before.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => GroupExpenseSplitDto)
  splits?: GroupExpenseSplitDto[];
}
