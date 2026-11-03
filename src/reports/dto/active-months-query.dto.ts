import { IsIn, IsUUID, ValidateIf } from 'class-validator';
import { whenSent } from '../../common/dto.js';

// Which months a period picker shows as having anything: income and
// expense (Income & Expense, the default), one account's entries (its
// ledger), or the transfers between the workspace's own accounts.
export class ActiveMonthsQueryDto {
  @ValidateIf(whenSent)
  @IsIn(['transfers'])
  scope?: 'transfers';

  @ValidateIf(whenSent)
  @IsUUID()
  accountId?: string;
}
