import { GroupContributionKind } from '@prisma/client';
import { IsDateString, IsEnum, IsNotEmpty, IsNumberString, IsOptional, IsString } from 'class-validator';

export class CreateGroupContributionDto {
  @IsString()
  @IsNotEmpty()
  groupMemberId: string;

  @IsNumberString()
  amount: string;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsString()
  note?: string;

  // DEPOSIT, RETURN (a negative amount), SETTLE (paying up between members)
  // or CARRY. Left out, the amount's sign says deposit or return.
  @IsOptional()
  @IsEnum(GroupContributionKind)
  kind?: GroupContributionKind;
}
