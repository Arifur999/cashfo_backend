import { BadRequestException } from '@nestjs/common';
import { INVISIBLE_ONLY } from './text.js';

// Control characters other than the line break and tab (a NUL byte can't be
// stored in a Postgres text column), and lone UTF-16 surrogates.
// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const UNSAFE_LONG_TEXT = /[\u0000-\u0008\u000b-\u001f\u007f]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

// cleanText() for writing that keeps its paragraphs (a note, a summary):
// NFC-normalised, Windows line breaks made plain ones, trailing spaces and
// blank lines at either end trimmed, the inside left as written. Text made
// only of invisible characters is ''.
export function cleanLongText(value: string, field: string, maxLength: number): string {
  const text = value
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .trim();
  if (UNSAFE_LONG_TEXT.test(text)) throw new BadRequestException(`The ${field} can't contain control or invalid characters`);
  if (text.length > maxLength) throw new BadRequestException(`The ${field} can't be longer than ${maxLength} characters`);
  return INVISIBLE_ONLY.test(text) ? '' : text;
}
