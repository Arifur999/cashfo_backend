import { IsDateString, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

export class CreateReceivableDto {
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

  // Optional -- falls back to the workspace's default income account, same
  // lowest-displayOrder lookup convention as Prompt 6's QuickEntriesService.
  @IsOptional()
  @IsString()
  incomeAccountId?: string;
}
