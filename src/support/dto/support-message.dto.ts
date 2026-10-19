import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { trim } from '../../common/dto.js';

// The topics Settings > Help offers, as the support team's categories.
export const SUPPORT_TOPICS = ['TECHNICAL', 'BUG_REPORT', 'ACCOUNT', 'BILLING', 'OTHER'] as const;

// Settings > Help > Send us a message. Sent as multipart form fields, with an
// optional screenshot beside them.
export class CreateSupportMessageDto {
  @IsIn(SUPPORT_TOPICS)
  category: (typeof SUPPORT_TOPICS)[number];

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
