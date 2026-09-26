import { IsBoolean, IsDateString, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CheckInHabitDto {
  @IsDateString()
  date: string;

  @IsOptional()
  @IsBoolean()
  completed?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  value?: number;

  @IsOptional()
  @IsString()
  note?: string;
}
