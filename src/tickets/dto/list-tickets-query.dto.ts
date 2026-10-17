import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { TicketCategory, TicketPriority, TicketStatus } from '@prisma/client';

// Besides one status, the admin list's tabs ask for a group: IN_QUEUE
// (open, in progress or waiting on the user) and DONE (resolved or closed).
export const TICKET_STATUS_GROUPS: Record<'IN_QUEUE' | 'DONE', TicketStatus[]> = {
  IN_QUEUE: [TicketStatus.OPEN, TicketStatus.IN_PROGRESS, TicketStatus.WAITING_ON_USER],
  DONE: [TicketStatus.RESOLVED, TicketStatus.CLOSED],
};

export type TicketStatusFilter = TicketStatus | keyof typeof TICKET_STATUS_GROUPS;

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

  @IsOptional()
  @IsString()
  assignedToAdminId?: string;

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
