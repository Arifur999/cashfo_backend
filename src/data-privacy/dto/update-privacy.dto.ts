import { IsBoolean, ValidateIf } from 'class-validator';
import { whenSent } from '../../common/dto.js';

// Settings › Data & privacy's switches; what is sent changes.
export class UpdatePrivacyDto {
  @ValidateIf(whenSent)
  @IsBoolean()
  shareUsage?: boolean;

  @ValidateIf(whenSent)
  @IsBoolean()
  showNameInGroups?: boolean;

  // Offers and discounts on Pro: the "News and tips" email alert.
  @ValidateIf(whenSent)
  @IsBoolean()
  marketingEmails?: boolean;
}
