import { SavingsGoalStatus } from '@prisma/client';
import { IsIn } from 'class-validator';

// WITHDRAWN only ever comes from the withdraw flow, which pays the money out
// -- set here it would strand the goal's savings behind a hidden Withdraw.
export class UpdateSavingsGoalStatusDto {
  @IsIn([SavingsGoalStatus.ACTIVE, SavingsGoalStatus.PAUSED, SavingsGoalStatus.COMPLETED])
  status: SavingsGoalStatus;
}
