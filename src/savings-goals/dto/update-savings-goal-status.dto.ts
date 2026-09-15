import { SavingsGoalStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateSavingsGoalStatusDto {
  @IsEnum(SavingsGoalStatus)
  status: SavingsGoalStatus;
}
