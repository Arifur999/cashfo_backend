import { Transform } from 'class-transformer';
import { IsString, MaxLength } from 'class-validator';
import { trim } from '../../common/dto.js';

// The admin top bar's search box.
export class AdminSearchQueryDto {
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q: string;
}
