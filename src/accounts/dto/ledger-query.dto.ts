import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
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

  // A note, a reference, a name or an amount.
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  search?: string;
}
