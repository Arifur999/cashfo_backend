import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { trim } from '../../common/dto.js';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  // Cleared by sending an empty string -- IsOptional lets the field be
  // omitted entirely, but an empty string still passes IsString, so
  // "remove my phone number" and "don't touch it" are both expressible.
  @IsOptional()
  @IsString()
  phone?: string;

  // One line ("House 12, Road 5, Dhanmondi, Dhaka"); an empty string clears it.
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  address?: string;
}
