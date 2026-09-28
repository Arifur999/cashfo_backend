import { BadRequestException } from '@nestjs/common';

// Control characters (a NUL byte can't be stored in a Postgres text column --
// it surfaces as a 500) and lone UTF-16 surrogates (Postgres silently stores
// them as U+FFFD, so "the same name" could be added again and again).
// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
export const UNSAFE_TEXT = /[\u0000-\u001f\u007f]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

// Only whitespace and characters that render as nothing: visually empty.
// Default_Ignorable_Code_Point is Unicode's own list of those -- zero-width
// space/joiners, bidi marks (LRM/RLM and the embeddings/isolates), the soft
// hyphen, Hangul fillers, variation selectors, the byte-order mark, tag
// characters and so on -- plus the braille blank, which draws an empty cell.
// (ZWJ/ZWNJ inside real Bangla text are kept -- they are meaningful there --
// so this is only a check, not something that is stripped.)
export const INVISIBLE_ONLY = /^[\s\p{Default_Ignorable_Code_Point}\u2800]*$/u;

// NFC-normalise, trim and collapse whitespace, then reject control characters
// and enforce the length limit. The DTO already checked the length of the raw
// text, but NFC can LENGTHEN Bangla (the RRA/RHA/YYA letters decompose into two
// code points), so the limit is enforced again on the cleaned value.
export function cleanText(value: string, field: string, maxLength: number): string {
  const text = value.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (UNSAFE_TEXT.test(text)) {
    throw new BadRequestException(`The ${field} can't contain control or invalid characters`);
  }
  if (text.length > maxLength) {
    throw new BadRequestException(`The ${field} can't be longer than ${maxLength} characters`);
  }
  return text;
}

// cleanText() for a field that must not be empty -- including text that is
// made only of invisible characters and would show as a blank name.
export function cleanRequiredText(value: string, field: string, maxLength: number): string {
  const text = cleanText(value, field, maxLength);
  if (INVISIBLE_ONLY.test(text)) throw new BadRequestException(`A ${field} is required`);
  return text;
}

// cleanText() for an optional field: invisible-only text is stored as ''.
export function cleanOptionalText(value: string, field: string, maxLength: number): string {
  const text = cleanText(value, field, maxLength);
  return INVISIBLE_ONLY.test(text) ? '' : text;
}
