import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { trim } from '../../common/dto.js';

// POST /admin/owners/:userId/notes
export class CreateAdminNoteDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  body: string;
}
