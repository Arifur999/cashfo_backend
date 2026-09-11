import { IsDateString, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

export class CreatePayableDto {
  @IsString()
  @IsNotEmpty()
  contactId: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  description?: string;

  // Optional -- falls back to the workspace's default expense account (same
  // lowest-displayOrder convention as the income-account default).
  @IsOptional()
  @IsString()
  expenseAccountId?: string;
}
