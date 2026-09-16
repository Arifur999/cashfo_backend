import { IsNotEmpty, IsString } from 'class-validator';

export class WithdrawReferralEarningsDto {
  @IsString()
  @IsNotEmpty()
  accountId: string;
}
