import { IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator';
import { whenSent } from '../../common/dto.js';

// Setting or changing the vault password always requires the account
// password too (same as ChangePasswordDto) -- proves it's really the
// account owner, not just someone who grabbed an unlocked session.
// Changing one that already exists also requires the current vault
// password: the vault promises to stay locked even if the account password
// leaks. Forgot it? POST /api/vault/reset/start, then /api/vault/reset.
//
// The new password's rules (vault-password-rule.ts) are checked by the
// service, so a weak one answers with a `reason` the screen can show.
export class SetVaultPasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @ValidateIf(whenSent)
  @IsString()
  @IsNotEmpty()
  currentVaultPassword?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  vaultPassword: string;
}
