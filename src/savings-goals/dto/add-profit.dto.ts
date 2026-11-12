import { Transform } from 'class-transformer';
import { IsDateString, IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator';
import { IsMoney, trim, whenSent } from '../../common/dto.js';

// Profit the bank paid on a goal's savings (Add money > Profit): it lands in
// the account the goal keeps its money in and counts as income under the
// category picked. No account of the customer's pays it.
export class AddProfitDto {
  @IsMoney()
  amount: number;

  @IsDateString()
  date: string;

  // The income category, by name (as a transaction's category is stored).
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Pick the income category.' })
  @MaxLength(80)
  category: string;

  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  notes?: string;
}
