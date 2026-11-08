import { GroupMemberRole } from '@prisma/client';
import { IsBoolean, IsDateString, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { whenSent } from '../../common/dto.js';

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

  // Member gives money to an accountant; an accountant keeps the cash (up
  // to 2 active in a group).
  @ValidateIf(whenSent)
  @IsEnum(GroupMemberRole)
  role?: GroupMemberRole;

  // The group's owner, added by the New group dialog (one per group).
  @ValidateIf(whenSent)
  @IsBoolean()
  isOwner?: boolean;

  // Who their share covers ("Khaled, wife and daughter").
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(120)
  household?: string | null;
}
