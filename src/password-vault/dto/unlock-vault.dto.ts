import { IsNotEmpty, IsString } from 'class-validator';

export class UnlockVaultDto {
  @IsString()
  @IsNotEmpty()
  vaultPassword: string;
}
