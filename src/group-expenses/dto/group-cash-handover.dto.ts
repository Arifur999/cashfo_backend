import { Transform } from 'class-transformer';
import { IsDateString, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateIf } from 'class-validator';
import { trim, whenSent } from '../../common/dto.js';

const POSITIVE_MONEY = /^\d{1,12}(\.\d{1,2})?$/;
const MONEY_MESSAGE = 'amount must be a positive amount with at most two decimals';

// Cash handed from one holder to another (the Cash book's "Hand over cash").
export class CreateGroupCashHandoverDto {
  @IsUUID()
  fromMemberId: string;

  @IsUUID()
  toMemberId: string;

  @Matches(POSITIVE_MONEY, { message: MONEY_MESSAGE })
  amount: string;

  @IsDateString()
  date: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class UpdateGroupCashHandoverDto {
  @ValidateIf(whenSent)
  @IsUUID()
  fromMemberId?: string;

  @ValidateIf(whenSent)
  @IsUUID()
  toMemberId?: string;

  @ValidateIf(whenSent)
  @Matches(POSITIVE_MONEY, { message: MONEY_MESSAGE })
  amount?: string;

  @ValidateIf(whenSent)
  @IsDateString()
  date?: string;

  // null clears it.
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  note?: string | null;
}
