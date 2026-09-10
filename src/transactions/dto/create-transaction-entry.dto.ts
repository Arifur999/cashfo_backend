import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';
import { EntryType } from '@prisma/client';

export class CreateTransactionEntryDto {
  @IsString()
  @IsNotEmpty()
  accountId: string;

  @IsEnum(EntryType)
  entryType: EntryType;

  // Money as a JSON number, validated to at most 2 decimal places -- the
  // service layer still re-derives exact totals via Prisma.Decimal rather
  // than trusting this float, per Prompt 5's explicit "never use plain JS
  // floats for money math" instruction.
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
