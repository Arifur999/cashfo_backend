export type CsvCell = string | number | boolean | Date | null | undefined | { toFixed(digits: number): string };

const NUMBER = /^-?\d+(\.\d+)?$/;
// A cell a spreadsheet would run as a formula ("=HYPERLINK(...)").
const FORMULA_START = /^[=+\-@\t\r]/;

function cellText(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return value.toFixed(2);
  const text = String(value);
  // Text someone typed is kept as text, never run: a leading ' makes the
  // spreadsheet show it as typed. Plain numbers stay numbers.
  return typeof value === 'string' && FORMULA_START.test(text) && !NUMBER.test(text) ? `'${text}` : text;
}

const quoted = (text: string) => (/[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);

// One spreadsheet: a header row and the rows, with a byte-order mark so
// Excel reads Bangla as UTF-8.
export function toCsv(headers: string[], rows: CsvCell[][]): Buffer {
  const lines = [headers, ...rows].map((row) => row.map((cell) => quoted(cellText(cell))).join(','));
  return Buffer.from(`﻿${lines.join('\r\n')}\r\n`, 'utf8');
}

// A @db.Date column as YYYY-MM-DD.
export const day = (date: Date | null | undefined) => (date ? date.toISOString().slice(0, 10) : '');
