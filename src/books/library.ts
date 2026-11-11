// The pure rules behind My Library's v16 pages: a note's highlights, a day
// typed by the reader, and where a day of reading began. Tested on their own.

import { BadRequestException } from '@nestjs/common';
import { MARK_COLORS } from './book-colors.js';

export type MarkColor = (typeof MARK_COLORS)[number];

// One highlighted stretch of a note's text: [s, e) in characters.
export interface NoteMark {
  s: number;
  e: number;
  c: MarkColor;
}

// The highlights as they are stored: inside the text, in order, never
// overlapping (the reader paints over a stretch to change its colour, so
// the client sends the merged list). null for none.
export function cleanMarks(marks: readonly { s: number; e: number; c: string }[], text: string): NoteMark[] | null {
  const sorted = [...marks].sort((a, b) => a.s - b.s);
  let end = 0;
  for (const mark of sorted) {
    if (!(MARK_COLORS as readonly string[]).includes(mark.c)) throw new BadRequestException('Pick yellow, green or pink');
    if (!Number.isInteger(mark.s) || !Number.isInteger(mark.e) || mark.s < 0 || mark.e <= mark.s || mark.e > text.length) {
      throw new BadRequestException('A highlight must cover words of the note');
    }
    if (mark.s < end) throw new BadRequestException("Highlights can't overlap");
    end = mark.e;
  }
  return sorted.length ? sorted.map((mark) => ({ s: mark.s, e: mark.e, c: mark.c as MarkColor })) : null;
}

// Read back from the JSON column: anything that isn't a list of marks is none.
export function storedMarks(value: unknown): NoteMark[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (mark): mark is NoteMark =>
      typeof mark === 'object' &&
      mark !== null &&
      Number.isInteger((mark as NoteMark).s) &&
      Number.isInteger((mark as NoteMark).e) &&
      (MARK_COLORS as readonly string[]).includes((mark as NoteMark).c),
  );
}

// A 'YYYY-MM-DD' the calendar really has (no 31 February).
export function isRealDay(day: string): boolean {
  const date = new Date(`${day}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === day;
}

// A day the reader picked for a note or a day of reading: a real one, not
// still to come (today is Asia/Dhaka's), and not before the year 2000.
export function pastDay(day: string, today: string, what = 'date'): string {
  if (!isRealDay(day) || day < '2000-01-01') throw new BadRequestException(`Pick a real ${what}`);
  if (day > today) throw new BadRequestException(`The ${what} can't be in the future`);
  return day;
}

// A book's latest day of reading, as Reading now shows it: the page it
// began on and the page it ended on. Rows logged before the start page was
// kept end where the book is now.
export function dayOfReading(log: { pages: number; fromPage: number | null }, pagesRead: number): { from: number; to: number } {
  if (log.fromPage !== null) return { from: log.fromPage, to: log.fromPage + log.pages };
  return { from: Math.max(0, pagesRead - log.pages), to: pagesRead };
}

// Where a new day of reading on `day` begins. The latest day already logged
// can be corrected (it begins where it began); a day before it can't be
// logged any more, so the history stays in order.
export function readingStart(
  day: string,
  latest: { date: string; pages: number; fromPage: number | null } | null,
  pagesRead: number,
  hasLogOn: boolean,
): { from: number; correcting: boolean } {
  if (latest && day === latest.date) return { from: dayOfReading(latest, pagesRead).from, correcting: true };
  if (latest && day < latest.date) {
    if (hasLogOn) throw new BadRequestException('Only the latest day can be changed here');
    throw new BadRequestException(`Reading after this date is already logged. Pick ${latest.date} or later`);
  }
  return { from: pagesRead, correcting: false };
}

// The instant to record a book as finished on `day`: now when that is
// today, else Dhaka noon of that day (06:00 UTC), so it stays on that day.
export function finishedOn(day: string, today: string, now: Date): Date {
  return day === today ? now : new Date(`${day}T06:00:00.000Z`);
}
