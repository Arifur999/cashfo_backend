import { Equals, IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';

// "Forgot vault password?": a new vault password in exchange for every saved
// entry. The server could decrypt them, so letting the account password
// alone unlock the old entries would break the vault's promise to stay shut
// when the account password leaks -- a reset starts the vault empty.
export class ResetVaultDto {
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @MinLength(6)
  @MaxLength(128)
  @Matches(/(?=.*[A-Za-z])(?=.*\d)/, { message: 'Vault password must contain at least one letter and one number' })
  vaultPassword: string;

  // The client must say so explicitly; nothing is deleted by accident.
  @Equals('DELETE_ALL_ENTRIES')
  confirm: 'DELETE_ALL_ENTRIES';
}
