import { Transform } from 'class-transformer';
import { IsString, Matches } from 'class-validator';
import { trim } from '../../common/dto.js';

// The support code the customer read out (Settings > Security): View as
// customer and Download a copy each take one.
export class SupportCodeDto {
  @Transform(trim)
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Enter the 6-digit support code the customer gave you' })
  code: string;
}
