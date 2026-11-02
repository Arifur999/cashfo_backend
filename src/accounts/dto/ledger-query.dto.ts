import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { trim } from '../../common/dto.js';
import { LEDGER_KINDS, type LedgerKind } from '../ledger-kind.js';

export class LedgerQueryDto {
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @IsOptional()
  @IsISO8601()
  dateTo?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  // Only money in (received) or only money out (sent).
  @IsOptional()
  @IsIn(['in', 'out'])
  direction?: 'in' | 'out';

  // Only one kind of row (see ledger-kind.ts).
  @IsOptional()
  @IsIn(LEDGER_KINDS)
  kind?: LedgerKind;

  // Work the ledger out from what still stands: a voided entry and its
  // reversal leave the rows and the balances alike (Balance › Ledger, where
  // a deleted transfer is gone). They net to zero, so the closing balance is
  // the same either way.
  @IsOptional()
  @Transform(({ value }) => (value === 'true' || value === '1' ? true : value === 'false' || value === '0' ? false : value))
  @IsBoolean()
  standingOnly?: boolean;

  // A note, a reference, a name or an amount.
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  search?: string;
}
