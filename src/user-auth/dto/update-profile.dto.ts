import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

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
}
