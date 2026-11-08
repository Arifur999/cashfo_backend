import { IsUUID, ValidateIf } from 'class-validator';

// Settings › App preferences › Default account for new transactions; null
// goes back to the first wallet.
export class DefaultAccountDto {
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  accountId: string | null;
}
