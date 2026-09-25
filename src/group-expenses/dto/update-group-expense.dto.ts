import { GroupExpenseCategory } from '@prisma/client';
import { IsDateString, IsEnum, IsNumberString, IsOptional, IsString } from 'class-validator';

export class UpdateGroupExpenseDto {
  @IsOptional()
  @IsNumberString()
  amount?: string;

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsEnum(GroupExpenseCategory)
  category?: GroupExpenseCategory;

  @IsOptional()
  @IsString()
  description?: string;

  // Empty string clears it (no one tracked) -- undefined leaves it unchanged,
  // same "explicit empty vs omitted" convention as ContactsService.update()'s
  // photoUrl.
  @IsOptional()
  @IsString()
  paidByMemberId?: string;
}
