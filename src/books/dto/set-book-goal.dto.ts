import { IsInt, Max, Min } from 'class-validator';

export class SetBookGoalDto {
  @IsInt()
  @Min(1)
  @Max(1000)
  target: number;
}
