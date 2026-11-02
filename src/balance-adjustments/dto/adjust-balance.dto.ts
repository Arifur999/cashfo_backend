import { Transform } from 'class-transformer';
import { IsString, MaxLength, Min, ValidateIf } from 'class-validator';
import { IsMoney, trim, whenSent } from '../../common/dto.js';

// Match real balance: what the bank or wallet app shows right now.
export class AdjustBalanceDto {
  @IsMoney()
  @Min(0)
  realBalance: number;

  // Why it was off ("SMS fees I forgot to add"); only the member sees it.
  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  note?: string;
}
