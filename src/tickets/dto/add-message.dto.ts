import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { TicketStatus } from '@prisma/client';
import { whenSent } from '../../common/dto.js';

export class AddMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  message: string;

  @IsOptional()
  @IsString()
  attachmentUrl?: string;

  // A note for the other admins: kept on the ticket, never shown to the
  // customer, and no bell or email goes out for it.
  @ValidateIf(whenSent)
  @IsBoolean()
  isInternal?: boolean;

  // "After sending, set to": the status the ticket moves to once the
  // message is saved.
  @ValidateIf(whenSent)
  @IsEnum(TicketStatus)
  status?: TicketStatus;
}
