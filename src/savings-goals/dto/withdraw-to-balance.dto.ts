import { IsDateString, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { IsMoney } from '../../common/dto.js';

// Money out of a goal to a main balance account (cash, bank, mobile
// money), any amount up to what is saved. It comes out of the savings
// wallets that hold the goal's money, largest first.
export class WithdrawToBalanceDto {
  @IsMoney()
  amount: number;

  @IsString()
  @IsNotEmpty()
  toAccountId: string;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
