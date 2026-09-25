import { IsDateString, IsNumberString, IsOptional, IsString } from 'class-validator';

export class CreateGroupExpenseDto {
  @IsNumberString()
  amount: string;

  @IsDateString()
  date: string;

  // Free text, not validated against a fixed list -- matches
  // GroupExpense.category's own "loose string, not an enum/FK" schema
  // comment. Defaults to "Other" in the service if omitted.
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  description?: string;

  // Purely informational (who physically paid/shopped) -- never affects the
  // settlement math, which always splits the total equally across active
  // members. Omit if not tracked.
  @IsOptional()
  @IsString()
  paidByMemberId?: string;
}
