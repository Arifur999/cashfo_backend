import { IsDateString, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

export class AddContributionDto {
  @IsString()
  @IsNotEmpty()
  moneyAccountId: string;

  // Which Savings Wallet (Account, accountSubtype "savings") the money
  // lands in -- see SavingsGoalsService.requireSavingsAccount().
  @IsString()
  @IsNotEmpty()
  toAccountId: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
