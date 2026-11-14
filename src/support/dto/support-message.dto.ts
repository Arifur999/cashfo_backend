import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator';
import { trim, whenSent } from '../../common/dto.js';

// The topics Settings > Help offers, as the support team's categories.
export const SUPPORT_TOPICS = ['TECHNICAL', 'BUG_REPORT', 'ACCOUNT', 'BILLING', 'FEATURE_REQUEST', 'OTHER'] as const;

// How soon the customer needs an answer: Urgent goes to the top of the queue.
export const SUPPORT_PRIORITIES = ['NORMAL', 'URGENT'] as const;

// Settings > Help > Send us a message. Sent as multipart form fields, with an
// optional screenshot beside them.
export class CreateSupportMessageDto {
  @IsIn(SUPPORT_TOPICS)
  category: (typeof SUPPORT_TOPICS)[number];

  // The customer's own subject line; without one, the message's first line.
  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  subject?: string;

  @ValidateIf(whenSent)
  @IsIn(SUPPORT_PRIORITIES)
  priority?: (typeof SUPPORT_PRIORITIES)[number];

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  message: string;
}

// A customer's answer in one of their conversations.
export class ReplySupportMessageDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  message: string;
}
