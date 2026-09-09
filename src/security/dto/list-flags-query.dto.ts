import { IsEnum, IsOptional } from 'class-validator';
import { FlagStatus, Severity } from '@prisma/client';

export class ListFlagsQueryDto {
  @IsOptional()
  @IsEnum(FlagStatus)
  status?: FlagStatus;

  @IsOptional()
  @IsEnum(Severity)
  severity?: Severity;
}
