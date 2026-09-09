import { IsEnum } from 'class-validator';
import { FlagStatus } from '@prisma/client';

export class UpdateFlagDto {
  @IsEnum(FlagStatus)
  status: FlagStatus;
}
