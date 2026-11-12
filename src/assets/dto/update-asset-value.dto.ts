import { Transform } from 'class-transformer';
import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';
import { IsMoney, trim } from '../../common/dto.js';

export class UpdateAssetValueDto {
  @IsMoney()
  value: number;

  // The date this value became true (e.g. "I checked the market rate on
  // this date") -- becomes the new AssetValueHistory row's recordedAt,
  // overriding its @default(now()) so a value entered today for a past
  // date shows under that date in the history, not today's date.
  @IsDateString()
  date: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  note?: string;
}
