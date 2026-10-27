import { Equals } from 'class-validator';
import { DisableTwoStepDto } from '../../two-step/dto/two-step.dto.js';

// POST /api/account/delete: the account password (left out by a Google-only
// account, which must have signed in within 10 minutes), "DELETE" typed
// out, and with two-step on a code from the app or a backup code.
export class DeleteAccountDto extends DisableTwoStepDto {
  @Equals('DELETE', { message: 'Type DELETE to confirm' })
  confirm: string;
}
