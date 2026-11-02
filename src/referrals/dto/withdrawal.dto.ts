import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsNotEmpty, IsString, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { IsMoney, whenSent } from '../../common/dto.js';
import { MAX_WITHDRAWAL_LINES } from '../referral-money.js';

// "Keep your books right": when the request is paid, add it as Referral
// income to this wallet.
export class IncomeTargetDto {
  @IsString()
  @IsNotEmpty()
  businessId: string;

  @IsString()
  @IsNotEmpty()
  accountId: string;
}

export class StartWithdrawalDto {
  // The AVAILABLE commission lines to withdraw (Referrals > Withdraw).
  @ValidateIf(whenSent)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_WITHDRAWAL_LINES)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  commissionIds?: string[];

  // An older app asks for an amount instead: the oldest lines that cover it.
  @ValidateIf((dto: StartWithdrawalDto) => dto.commissionIds === undefined)
  @IsMoney()
  amount?: number;

  @IsString()
  @IsNotEmpty()
  methodId: string;

  @ValidateIf(whenSent)
  @ValidateNested()
  @Type(() => IncomeTargetDto)
  income?: IncomeTargetDto;
}

export class ConfirmWithdrawalDto {
  @IsString()
  @IsNotEmpty()
  challengeId: string;

  @Matches(/^\d{6}$/, { message: 'Enter the 6-digit code' })
  code: string;
}

export class PageQueryDto {
  @ValidateIf(whenSent)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ValidateIf(whenSent)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

// Friends who joined but haven't bought: a nudge in their bell.
export class RemindFriendsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  referralIds: string[];
}
