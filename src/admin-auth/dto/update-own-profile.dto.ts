import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { trim } from '../../common/dto.js';

// What an admin may change about themselves from My account: their name.
// Email and role are a super admin's to change, from the admin team.
export class UpdateOwnProfileDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;
}
