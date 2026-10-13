import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

// Setting or changing the vault password always requires the account
// password too (same as ChangePasswordDto) -- proves it's really the
// account owner, not just someone who grabbed an unlocked session.
// Changing one that already exists also requires the current vault
// password: the vault promises to stay locked even if the account password
// leaks. Forgot it? POST /api/vault/reset (which deletes the entries).
export class SetVaultPasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  currentVaultPassword?: string;

  @MinLength(6)
  @Matches(/(?=.*[A-Za-z])(?=.*\d)/, { message: 'Vault password must contain at least one letter and one number' })
  @MaxLength(128)
  vaultPassword: string;
}
