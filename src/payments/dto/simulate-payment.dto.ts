import { IsNotEmpty, IsString } from 'class-validator';

export class SimulatePaymentDto {
  @IsString()
  @IsNotEmpty()
  platformUserId: string;

  @IsString()
  @IsNotEmpty()
  planId: string;
}
