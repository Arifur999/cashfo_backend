import { GroupContributionKind } from '@prisma/client';
import { IsDateString, IsEnum, IsNotEmpty, IsNumberString, IsOptional, IsString, IsUUID, ValidateIf } from 'class-validator';

export class UpdateGroupContributionDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  groupMemberId?: string;

  @IsOptional()
  @IsNumberString()
  amount?: string;

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsString()
  note?: string;

  // DEPOSIT, RETURN (a negative amount), SETTLE (paying up between members)
  // or CARRY. Left out, the amount's sign says deposit or return.
  @IsOptional()
  @IsEnum(GroupContributionKind)
  kind?: GroupContributionKind;

  // The accountant it was given to ("Given to"); null for none. Left out on
  // a new deposit or return, the group's cash holder.
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsUUID()
  receivedByMemberId?: string | null;
}
