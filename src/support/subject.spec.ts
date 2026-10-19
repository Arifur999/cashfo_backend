import { describe, expect, it } from 'vitest';
import { subjectOf } from './subject.js';

describe('subjectOf', () => {
  it('takes the first line, spaces squeezed', () => {
    expect(subjectOf('  How do I   keep shop money apart?\nShould I add a wallet?')).toBe('How do I keep shop money apart?');
  });

  it('cuts a long line at a word', () => {
    const long = 'How do I keep my shop money apart from my own money when both come into the same bKash number every day';
    const subject = subjectOf(long);
    expect(subject.length).toBeLessThanOrEqual(80);
    expect(subject.endsWith('…')).toBe(true);
    expect(long.startsWith(subject.slice(0, -1))).toBe(true);
    expect(subject.slice(0, -1).endsWith(' ')).toBe(false);
  });
});
