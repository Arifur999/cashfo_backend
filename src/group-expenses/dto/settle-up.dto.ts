import { GroupPayMethod } from '@prisma/client';
import { IsDateString, IsEnum, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { whenSent } from '../../common/dto.js';

// A payment from one member to another, recorded as one commit.
export class SettleUpDto {
  @IsString()
  @IsNotEmpty()
  fromMemberId: string;

  @IsString()
  @IsNotEmpty()
  toMemberId: string;

  // A positive amount with at most two decimals, as a string.
  @Matches(/^\d{1,12}(\.\d{1,2})?$/, { message: 'amount must be a positive amount with at most two decimals' })
  amount: string;

  @IsDateString()
  date: string;

  // How it was paid (Settlement's "How"): cash, bKash, Nagad or bank.
  @ValidateIf(whenSent)
  @IsEnum(GroupPayMethod)
  method?: GroupPayMethod;

  // Each side's note, in the reader's language ("Paid to Rahim").
  @IsOptional()
  @IsString()
  @MaxLength(300)
  payerNote?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  receiverNote?: string;
}
