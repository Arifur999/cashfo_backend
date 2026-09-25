import { IsDateString, IsNotEmpty, IsNumberString, IsOptional, IsString } from 'class-validator';

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
}
