import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class UnlockVaultDto {
  @IsString()
  @IsNotEmpty()
  vaultPassword: string;
}

// The second unlock step: the code POST /api/vault/unlock emailed.
export class VerifyVaultUnlockDto {
  @IsString()
  @IsNotEmpty()
  challengeId: string;

  @Matches(/^\d{6}$/, { message: 'Enter the 6-digit code' })
  code: string;
}
