import { Transform } from 'class-transformer';
import { IsISO8601, IsNotEmpty, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { trim, whenSent } from '../../common/dto.js';

export class MarkPaidDto {
  // The gateway's transaction id (bKash/Nagad TrxID, bank reference).
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  gatewayReferenceId: string;

  // When the money arrived; now when left out. Not in the future.
  @ValidateIf(whenSent)
  @IsISO8601()
  paidAt?: string;

  // The number or account the money came from.
  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  payerAccount?: string;

  // Kept in the audit log.
  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class MarkFailedDto {
  @Transform(trim)
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}
