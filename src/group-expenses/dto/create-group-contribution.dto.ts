import { IsDateString, IsNotEmpty, IsNumberString, IsOptional, IsString } from 'class-validator';

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
}
