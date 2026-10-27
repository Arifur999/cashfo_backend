import { IsIn, IsNotEmpty, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { whenSent } from '../../common/dto.js';

// "Forgot vault password?": the account password (or, for a Google-only
// account, a sign-in in the last ten minutes) plus the code emailed by
// POST /api/vault/reset/start. Only the password that opens the vault
// changes; the saved logins stay (they are sealed with the server's key,
// not the vault password -- vault-crypto.ts).
export class StartVaultResetDto {
  @ValidateIf(whenSent)
  @IsString()
  @IsNotEmpty()
  currentPassword?: string;
}

export class ResetVaultDto {
  // Required when the account has a password; see StartVaultResetDto.
  @ValidateIf(whenSent)
  @IsString()
  @IsNotEmpty()
  currentPassword?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  vaultPassword: string;

  @IsString()
  @IsNotEmpty()
  challengeId: string;

  @Matches(/^\d{6}$/, { message: 'Enter the 6-digit code' })
  code: string;

  // Older clients confirmed deleting every entry; a reset keeps them now,
  // so the word is still accepted and nothing is deleted.
  @ValidateIf(whenSent)
  @IsIn(['DELETE_ALL_ENTRIES'])
  confirm?: 'DELETE_ALL_ENTRIES';
}
