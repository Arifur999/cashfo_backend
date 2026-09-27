import { IsInt, Max, Min } from 'class-validator';

export class SetSkillGoalDto {
  @IsInt()
  @Min(1)
  @Max(1000)
  target: number;
}
