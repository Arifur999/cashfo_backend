import { GroupMemberStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsISO8601, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

// Query strings reach Prisma as dates and enums; a malformed one used to
// end in a 500. Dates are plain calendar days, as the forms send them.
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = 'must be a date in YYYY-MM-DD form';

class DateRangeQueryDto {
  @IsOptional()
  @Matches(DATE_ONLY, { message: `from ${DATE_MESSAGE}` })
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: `to ${DATE_MESSAGE}` })
  @IsISO8601({ strict: true })
  to?: string;
}

export class ListGroupMembersQueryDto {
  @IsOptional()
  @IsEnum(GroupMemberStatus)
  status?: GroupMemberStatus;
}

export class ListGroupContributionsQueryDto extends DateRangeQueryDto {
  @IsOptional()
  @IsString()
  groupMemberId?: string;
}

export class ListGroupExpensesQueryDto extends DateRangeQueryDto {
  @IsOptional()
  @IsString()
  category?: string;
}

export class SettlementQueryDto extends DateRangeQueryDto {}

export class ListGroupMealsQueryDto extends DateRangeQueryDto {}

// The Cash book: one accountant's (or every accountant's) money in and out.
export class GroupCashbookQueryDto extends DateRangeQueryDto {
  @IsOptional()
  @IsString()
  accountantId?: string;
}

// The Activity log: newest first, a page at a time, optionally one kind.
export class GroupActivityQueryDto {
  @IsOptional()
  @IsIn(['ADDED', 'EDITED', 'DELETED', 'MONTH'])
  action?: 'ADDED' | 'EDITED' | 'DELETED' | 'MONTH';

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
