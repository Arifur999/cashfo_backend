// Habit Tracker > Write: the limits, colours and starter categories notes
// and the journal share, and the #tags read out of what is written. Pure.

// A note card's tint (the NotesHome board's six).
export const NOTE_COLORS = ['white', 'yellow', 'green', 'blue', 'pink', 'purple'] as const;

// A category's dot (the board's palette, in the order "Add" hands them out).
export const CATEGORY_COLORS = ['blue', 'rose', 'amber', 'violet', 'teal', 'green', 'slate'] as const;

// What a new writer starts with; deleting them all never brings them back.
export const STARTER_CATEGORIES: { name: string; color: (typeof CATEGORY_COLORS)[number] }[] = [
  { name: 'Work', color: 'blue' },
  { name: 'Family', color: 'rose' },
  { name: 'Business', color: 'amber' },
  { name: 'Study', color: 'violet' },
  { name: 'Personal', color: 'teal' },
];

export const NOTE_TITLE_MAX = 120;
export const NOTE_BODY_MAX = 5000;
// Notes are read all at once (the page counts them by kind, category and
// tag), so a person's notes stay a list a page can hold.
export const MAX_NOTES = 2000;
export const MAX_CATEGORIES = 20;
export const CATEGORY_NAME_MAX = 30;
export const TAG_MAX = 30;
export const TAGS_PER_NOTE = 10;
// A journal entry's #tags, read from its text.
export const TAGS_PER_ENTRY = 20;
export const JOURNAL_PROMPT_MAX = 1000;
export const JOURNAL_BODY_MAX = 10000;

// 0 Great, 1 Good, 2 Okay, 3 Low, 4 Hard.
export const MOOD_MIN = 0;
export const MOOD_MAX = 4;

// A tag as typed after "#": letters (Bangla too, with its vowel signs),
// digits, "_" and "-".
export const TAG_PATTERN = /^[\p{L}\p{M}\p{N}_-]{1,30}$/u;
const TAGS_IN_TEXT = /#([\p{L}\p{M}\p{N}_-]+)/gu;

// "furnify", "#Furnify " -> "furnify": how a tag is stored.
export const normalizeTag = (tag: string): string => tag.trim().replace(/^#+/, '').toLowerCase();

// A note's tags as sent: stored lowercase, once each, in the order given.
export function cleanTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map(normalizeTag).filter(Boolean))];
}

// The #tags written in some text, lowercase, once each, the first `limit`
// of them; a tag longer than a stored tag may be is cut to that length.
export function tagsIn(texts: readonly string[], limit = TAGS_PER_ENTRY): string[] {
  const found = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(TAGS_IN_TEXT)) {
      found.add(match[1].toLowerCase().slice(0, TAG_MAX));
      if (found.size >= limit) return [...found];
    }
  }
  return [...found];
}

// 'YYYY-MM' -> the month's first day and the next month's, at UTC midnight
// (the shape of a @db.Date column).
export function monthBounds(month: string): { start: Date; end: Date } {
  const [year, monthNumber] = month.split('-').map(Number);
  return { start: new Date(Date.UTC(year, monthNumber - 1, 1)), end: new Date(Date.UTC(year, monthNumber, 1)) };
}

// 'YYYY-MM-DD' that names a real calendar day.
export function isCalendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
