import { IsBoolean, ValidateIf } from 'class-validator';
import { whenSent } from '../../common/dto.js';

// Settings > Security > Alerts: any of the three switches, the rest stay.
export class UpdateAlertsDto {
  @ValidateIf(whenSent)
  @IsBoolean()
  alertNewDevice?: boolean;

  @ValidateIf(whenSent)
  @IsBoolean()
  alertFailedTries?: boolean;

  @ValidateIf(whenSent)
  @IsBoolean()
  askCodeBeforeReset?: boolean;
}
