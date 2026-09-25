import { GroupExpenseCategory } from '@prisma/client';
import { IsDateString, IsEnum, IsNumberString, IsOptional, IsString } from 'class-validator';

export class CreateGroupExpenseDto {
  @IsNumberString()
  amount: string;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsEnum(GroupExpenseCategory)
  category?: GroupExpenseCategory;

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
