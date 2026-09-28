import { IsInt, Max, Min } from 'class-validator';
import { dhakaYear } from './dhaka.js';

// "Finish N books / complete N skills this year" -- one target per user per
// Asia/Dhaka year, shared by the Book and Skills modules.

export class SetYearlyGoalDto {
  @IsInt()
  @Min(1)
  @Max(1000)
  target: number;
}

export interface YearlyGoal {
  year: number;
  goalTarget: number | null;
}

// `save` upserts the target for the given year, `clear` deletes it; each
// module passes its own goal table.
export async function setYearlyGoal(target: number, save: (year: number) => Promise<unknown>): Promise<YearlyGoal> {
  const year = dhakaYear(new Date());
  await save(year);
  return { year, goalTarget: target };
}

export async function clearYearlyGoal(clear: (year: number) => Promise<unknown>): Promise<YearlyGoal> {
  const year = dhakaYear(new Date());
  await clear(year);
  return { year, goalTarget: null };
}
