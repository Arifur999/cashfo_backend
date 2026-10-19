import { GroupMemberStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min, ValidateIf } from 'class-validator';

export class UpdateGroupMemberDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  photoUrl?: string;

  @IsOptional()
  @IsEnum(GroupMemberStatus)
  status?: GroupMemberStatus;

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

  // The day they left: they share no costs after it. null: still here.
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsDateString()
  leftOn?: string | null;
}
