import { IsEnum, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';
import { ErrorSource, Severity } from '@prisma/client';

export class ReportErrorDto {
  @IsEnum(ErrorSource)
  source: ErrorSource;

  @IsString()
  @IsNotEmpty()
  message: string;

  @IsOptional()
  @IsString()
  stackTrace?: string;

  @IsEnum(Severity)
  severity: Severity;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
