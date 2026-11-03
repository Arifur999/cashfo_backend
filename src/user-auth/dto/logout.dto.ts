import { IsBoolean, ValidateIf } from 'class-validator';
import { whenSent } from '../../common/dto.js';
import { RefreshDto } from './refresh.dto.js';

// Sign out: this device, or with `everywhere` every device the account is
// signed in on (the sidebar's "Sign out on all my devices").
export class LogoutDto extends RefreshDto {
  @ValidateIf(whenSent)
  @IsBoolean()
  everywhere?: boolean;
}
