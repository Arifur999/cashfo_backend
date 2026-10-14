import { GroupMemberStatus } from '@prisma/client';
import { IsEnum, IsISO8601, IsOptional, IsString, Matches } from 'class-validator';

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
