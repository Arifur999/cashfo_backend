import { IsDateString, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { IsMoney } from '../../common/dto.js';

export class AddContributionDto {
  @IsString()
  @IsNotEmpty()
  moneyAccountId: string;

  // Which Savings Wallet (Account, accountSubtype "savings") the money
  // lands in -- see SavingsGoalsService.requireSavingsAccount().
  @IsString()
  @IsNotEmpty()
  toAccountId: string;

  @IsMoney()
  amount: number;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
