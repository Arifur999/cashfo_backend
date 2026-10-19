import { IsNumber, IsNumberString, IsUUID, Max, Min, ValidateIf } from 'class-validator';

// One member an expense names: their units (shared by shares) or their
// amount (exact amounts); neither for an equal split among the named.
export class GroupExpenseSplitDto {
  @IsUUID()
  groupMemberId: string;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000)
  units?: number | null;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsNumberString()
  amount?: string | null;
}
