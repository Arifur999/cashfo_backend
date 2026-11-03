import { IsDateString, IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator';
import { IsMoney, whenSent } from '../../common/dto.js';

export class AddContributionDto {
  @IsString()
  @IsNotEmpty()
  moneyAccountId: string;

  // Which Savings Wallet (Account, accountSubtype "savings") the money
  // lands in -- see SavingsGoalsService.requireSavingsAccount(). Left out,
  // the account the goal keeps its money in.
  @ValidateIf(whenSent)
  @IsString()
  @IsNotEmpty()
  toAccountId?: string;

  @IsMoney()
  amount: number;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
