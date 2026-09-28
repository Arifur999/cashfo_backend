import { Matches } from 'class-validator';

// A plain "YYYY-MM-DD" date, no time component -- the list itself has no
// notion of a time zone (it's just "the list for that calendar date").
// @IsDateString() alone isn't enough here: it accepts a full ISO8601
// datetime (with a time/offset) or even a bare year/month, which would then
// break TodosService.create()'s `${date}T00:00:00.000Z` concatenation --
// this exact shape is required instead. The service still re-validates that
// the string is a real calendar date (e.g. rejects "2024-02-30").
export class CreateTodoListDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be in YYYY-MM-DD format' })
  date: string;
}
