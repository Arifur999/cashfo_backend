import { BadRequestException } from '@nestjs/common';

// Control characters (a NUL byte can't be stored in a Postgres text column --
// it surfaces as a 500) and lone UTF-16 surrogates.
// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
export const UNSAFE_TEXT = /[\u0000-\u001f\u007f]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

// Zero-width space / non-joiner / joiner, word joiner, byte-order mark. Built
// from char codes so the source stays plain ASCII (invisible characters typed
// into a regex literal are easy to lose or mangle).
const ZERO_WIDTH = [0x200b, 0x200c, 0x200d, 0x2060, 0xfeff].map((code) => String.fromCharCode(code)).join('');

// Only whitespace and zero-width characters: visually empty. (ZWJ/ZWNJ inside
// real Bangla text are kept -- they are meaningful there -- so this is only a
// check, not something that is stripped.)
export const INVISIBLE_ONLY = new RegExp(String.raw`^[\s${ZERO_WIDTH}]*$`);

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
