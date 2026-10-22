import { Transform } from 'class-transformer';
import { IsString, Matches } from 'class-validator';
import { trim } from '../../common/dto.js';

// The support code the customer read out (Settings > Security).
export class StartImpersonationDto {
  @Transform(trim)
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Enter the 6-digit support code the customer gave you' })
  code: string;
}
