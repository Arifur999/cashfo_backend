import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsNotEmpty, IsString, Matches, Max, Min, ValidateIf, ValidateNested } from 'class-validator';
import { IsMoney, whenSent } from '../../common/dto.js';

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
  // Taken from the available balance; the member receives it less the fee.
  @IsMoney()
  amount: number;

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
