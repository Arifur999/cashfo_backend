import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { trim, whenSent } from '../../common/dto.js';
import { stripSpaces } from '../../sign-in/two-step-sign-in.dto.js';

const CODE_MESSAGE = 'code must be the 6-digit code from your authenticator app';

// The account password, to confirm a two-step change. A Google-only account
// has none and leaves it out (a sign-in in the last 10 minutes counts).
class WithPassword {
  @ValidateIf(whenSent)
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password?: string;
}

// POST .../two-step/setup
export class StartTwoStepSetupDto extends WithPassword {}

// POST /admin/auth/two-step/setup: or, for an admin who must turn it on
// before getting in, the setupToken the sign-in answered with.
export class AdminStartTwoStepSetupDto extends WithPassword {
  @ValidateIf(whenSent)
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  setupToken?: string;
}

// POST .../two-step/enable: the first code from the app.
export class EnableTwoStepDto {
  @Transform(stripSpaces)
  @IsString()
  @Matches(/^\d{6}$/, { message: CODE_MESSAGE })
  code: string;
}

// POST /admin/auth/two-step/enable with a setupToken also signs the admin
// in, and may trust this computer for 30 days.
export class AdminEnableTwoStepDto extends EnableTwoStepDto {
  @ValidateIf(whenSent)
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  setupToken?: string;

  @ValidateIf(whenSent)
  @IsBoolean()
  trustDevice?: boolean;
}

// POST .../two-step/backup-codes
export class RegenerateBackupCodesDto extends WithPassword {
  @Transform(stripSpaces)
  @IsString()
  @Matches(/^\d{6}$/, { message: CODE_MESSAGE })
  code: string;
}

// POST .../two-step/disable: a code from the app or a backup code.
export class DisableTwoStepDto extends WithPassword {
  @ValidateIf(whenSent)
  @Transform(stripSpaces)
  @IsString()
  @Matches(/^\d{6}$/, { message: CODE_MESSAGE })
  code?: string;

  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @MaxLength(20)
  backupCode?: string;
}
