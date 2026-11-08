import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { trim } from '../../common/dto.js';

// My books' "New shelf".
export class CreateBookShelfDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  name: string;
}
