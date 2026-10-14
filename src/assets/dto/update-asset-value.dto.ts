import { IsDateString, IsOptional, IsString } from 'class-validator';
import { IsMoney } from '../../common/dto.js';

export class UpdateAssetValueDto {
  @IsMoney()
  value: number;

  // The date this value became true (e.g. "I checked the market rate on
  // this date") -- becomes the new AssetValueHistory row's recordedAt,
  // overriding its @default(now()) so a value entered today for a past
  // date shows under that date in the "View Details" history list, not
  // today's date.
  @IsDateString()
  date: string;

  @IsOptional()
  @IsString()
  note?: string;
}
