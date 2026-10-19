import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator';
import { trim, whenSent } from '../../common/dto.js';

// Settings > Help > Have an idea?: a feature others can vote for.
export class CreateIdeaDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title: string;

  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  description?: string;
}
