import { IsDateString, IsNotEmpty, IsOptional, IsString } from 'class-validator';

// No `amount` field -- withdraw() always cashes out the goal's ENTIRE
// current saved amount at once (no partial withdrawal yet, see
// SavingsGoalsService.withdraw()'s comment).
export class WithdrawSavingsGoalDto {
  // Which Savings Wallet the money physically leaves from -- see
  // SavingsGoalsService.requireSavingsAccount().
  @IsString()
  @IsNotEmpty()
  savingsAccountId: string;

  @IsString()
  @IsNotEmpty()
  expenseAccountId: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
