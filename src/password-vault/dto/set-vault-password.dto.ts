import { IsNotEmpty, IsString, Matches, MinLength } from 'class-validator';

// Setting or changing the vault password always requires the account
// password too (same as ChangePasswordDto) -- proves it's really the
// account owner, not just someone who grabbed an unlocked session.
export class SetVaultPasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @MinLength(6)
  @Matches(/(?=.*[A-Za-z])(?=.*\d)/, { message: 'Vault password must contain at least one letter and one number' })
  vaultPassword: string;
}
