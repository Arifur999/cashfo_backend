import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { trim, whenSent } from '../common/dto.js';

// Spaces people type inside a six-digit code ("481 527").
export const stripSpaces = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.replace(/\s/g, '') : value);

// POST /api/auth/sign-in/two-step: the second step of a sign-in. Exactly one
// of code (from the authenticator app) and backupCode.
export class TwoStepSignInDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  challengeToken: string;

  @ValidateIf(whenSent)
  @Transform(stripSpaces)
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be the 6-digit code from your authenticator app' })
  code?: string;

  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @MaxLength(20)
  backupCode?: string;

  // "Don't ask again on this computer for 30 days".
  @ValidateIf(whenSent)
  @IsBoolean()
  trustDevice?: boolean;
}
