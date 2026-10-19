import { GroupPaidFrom, GroupSplit } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDateString, IsEnum, IsNumberString, IsOptional, IsString, ValidateNested } from 'class-validator';
import { GroupExpenseSplitDto } from './group-expense-split.dto.js';

export class CreateGroupExpenseDto {
  @IsNumberString()
  amount: string;

  @IsDateString()
  date: string;

  // Free text, not validated against a fixed list -- matches
  // GroupExpense.category's own "loose string, not an enum/FK" schema
  // comment. Defaults to "Other" in the service if omitted.
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  description?: string;

  // Who paid it. With paidFrom MEMBER it came out of their own pocket and
  // they are credited for it; otherwise it only says who went to the shops.
  // Omit if not tracked.
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
