import { IsBoolean, IsIn, ValidateIf } from 'class-validator';
import { whenSent } from '../../common/dto.js';
import { KEEP_CHOICES } from '../backups.service.js';

// Settings › Data & privacy › Backup and restore; what is sent changes.
export class UpdateBackupSettingsDto {
  @ValidateIf(whenSent)
  @IsBoolean()
  auto?: boolean;

  @ValidateIf(whenSent)
  @IsIn(['daily', 'weekly'])
  every?: 'daily' | 'weekly';

  @ValidateIf(whenSent)
  @IsIn([...KEEP_CHOICES])
  keep?: number;
}
