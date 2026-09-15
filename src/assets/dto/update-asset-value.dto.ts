import { IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

export class UpdateAssetValueDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  value: number;

  @IsOptional()
  @IsString()
  note?: string;
}
