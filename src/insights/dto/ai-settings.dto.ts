import { AiSection } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, ValidateIf } from 'class-validator';
import { whenSent } from '../../common/dto.js';

// AI Insights on or off, and the parts of the person's records it may read.
export class UpdateAiSettingsDto {
  @ValidateIf(whenSent)
  @IsBoolean()
  on?: boolean;

  @ValidateIf(whenSent)
  @IsArray()
  @ArrayMaxSize(4)
  @IsIn(Object.values(AiSection), { each: true })
  reads?: AiSection[];
}
