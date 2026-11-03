import { Transform } from 'class-transformer';
import { IsDateString, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { IsMoney, trim, whenSent } from '../../common/dto.js';

export class CreateTransferDto {
  @IsString()
  @IsNotEmpty()
  fromAccountId: string;

  @IsString()
  @IsNotEmpty()
  toAccountId: string;

  @IsMoney()
  amount: number;

  // A bank or service charge paid on the transfer, out of the sending
  // wallet: an expense of its own tied to it (chargeForId), voided and
  // corrected with it.
  @ValidateIf(whenSent)
  @IsMoney()
  charge?: number;

  // The expense category the charge is filed under (a budget category's
  // name); "Bank charge" when left out.
  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  chargeCategory?: string;

  @IsDateString()
  date: string;

  // The popup's Description box holds 500 characters.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
