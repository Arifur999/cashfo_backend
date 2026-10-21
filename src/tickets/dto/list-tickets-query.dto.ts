import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, Max, Min, ValidateIf } from 'class-validator';
import { TicketCategory, TicketPriority, TicketStatus } from '@prisma/client';
import { whenSent } from '../../common/dto.js';

// Besides one status, the admin list's tabs ask for a group: IN_QUEUE
// (open, in progress or waiting on the user) and DONE (resolved or closed).
export const TICKET_STATUS_GROUPS: Record<'IN_QUEUE' | 'DONE', TicketStatus[]> = {
  IN_QUEUE: [TicketStatus.OPEN, TicketStatus.IN_PROGRESS, TicketStatus.WAITING_ON_USER],
  DONE: [TicketStatus.RESOLVED, TicketStatus.CLOSED],
};

export type TicketStatusFilter = TicketStatus | keyof typeof TICKET_STATUS_GROUPS;

// assignedToAdminId=none asks for the tickets nobody is assigned to. Admin
// ids are UUIDs, so no admin's id can be the word.
export const UNASSIGNED = 'none';

// queue: today's order (unassigned first, then priority, then newest), the
// same as leaving sort out; a sort menu needs a name for it to send.
// waiting: the most urgent first, then whoever has waited longest for the
// team.
export const TICKET_SORTS = ['queue', 'waiting'] as const;
export type TicketSort = (typeof TICKET_SORTS)[number];

// A flag as a query string carries it: "true"/"1" or "false"/"0".
const toBoolean = ({ value }: { value: unknown }) => (value === 'true' || value === '1' ? true : value === 'false' || value === '0' ? false : value);

export class ListTicketsQueryDto {
  @IsOptional()
  @IsIn([...Object.values(TicketStatus), ...Object.keys(TICKET_STATUS_GROUPS)])
  status?: TicketStatusFilter;

  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @IsOptional()
  @IsEnum(TicketCategory)
  category?: TicketCategory;

  // An admin's id, or UNASSIGNED.
  @IsOptional()
  @IsString()
  assignedToAdminId?: string;

  // true: only the unsolved tickets whose newest message is the customer's,
  // or that have none -- what the stats count as needsReplyCount. false
  // filters nothing, like leaving it out.
  @ValidateIf(whenSent)
  @Transform(toBoolean)
  @IsBoolean()
  awaitingReply?: boolean;

  @ValidateIf(whenSent)
  @IsIn(TICKET_SORTS)
  sort?: TicketSort;

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
