import { Type } from 'class-transformer';
import { IsNotEmpty, IsPositive, IsString, MinLength } from 'class-validator';

export class RefundPaymentDto {
  // Prisma Decimal fields serialize to strings in JSON, and the frontend
  // pre-fills the refund amount input from that string -- coerce here so
  // both "799.00" (string) and 799 (number) validate correctly.
  @Type(() => Number)
  @IsPositive()
  amount: number;

  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  reason: string;
}
