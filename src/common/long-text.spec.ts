import { describe, expect, it } from 'vitest';
import { cleanLongText } from './long-text.js';

describe('cleanLongText', () => {
  it('keeps the paragraphs and trims the ends', () => {
    expect(cleanLongText('\r\n  First line  \r\n\r\nSecond\tline\t\n ', 'note', 100)).toBe('First line\n\nSecond\tline');
  });

  it('refuses control characters and text over the limit', () => {
    expect(() => cleanLongText('a\u0000b', 'note', 100)).toThrow("The note can't contain control or invalid characters");
    expect(() => cleanLongText('abcdef', 'note', 5)).toThrow("The note can't be longer than 5 characters");
  });

  it('reads invisible-only text as empty', () => {
    expect(cleanLongText('​ \n ', 'note', 100)).toBe('');
  });
});
