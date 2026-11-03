import { Matches } from 'class-validator';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

// GET /api/habits/months: the first and last month of a run, YYYY-MM.
export class HabitMonthsQueryDto {
  @Matches(MONTH, { message: 'from must be YYYY-MM' })
  from: string;

  @Matches(MONTH, { message: 'to must be YYYY-MM' })
  to: string;
}
