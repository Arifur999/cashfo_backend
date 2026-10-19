import { IsDateString, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min, ValidateIf } from 'class-validator';

export class CreateGroupMemberDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  photoUrl?: string;

  // Their share of costs split by shares.
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100)
  shareUnits?: number;

  // The day they joined (YYYY-MM-DD): they share only costs from then on.
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsDateString()
  joinedOn?: string | null;
}
