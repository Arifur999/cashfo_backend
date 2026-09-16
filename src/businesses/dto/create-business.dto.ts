import { IsEnum, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { WorkspaceType } from '@prisma/client';

export class CreateBusinessDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  // Accepted (not hardcoded) so the service can reject PERSONAL with a clear
  // message rather than the request silently 400ing on an unrecognized value.
  @IsEnum(WorkspaceType)
  type: WorkspaceType;

  // No @IsIn restriction here -- Business.currency itself is a free-form
  // string (@default("BDT")), same as SubscriptionPlan.currency elsewhere.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  currency?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4,6}$/, { message: 'PIN must be 4 to 6 digits' })
  pin?: string;
}
