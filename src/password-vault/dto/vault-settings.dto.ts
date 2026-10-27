import { IsInt, Max, Min, ValidateIf } from 'class-validator';
import { VAULT_LOCK_MAX_MINUTES, VAULT_LOCK_MIN_MINUTES } from '../vault-unlock-limit.js';

// How long one unlock lasts. Must be sent: a number of minutes, or null for
// the server's default.
export class UpdateVaultSettingsDto {
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(VAULT_LOCK_MIN_MINUTES)
  @Max(VAULT_LOCK_MAX_MINUTES)
  lockMinutes: number | null;
}
