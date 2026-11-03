import { cleanTags, isCalendarDay, monthBounds, normalizeTag, TAG_PATTERN, tagsIn } from './writing-text.js';

describe('tags', () => {
  it('stores a tag lowercase, without its #', () => {
    expect(normalizeTag(' #Furnify ')).toBe('furnify');
    expect(cleanTags(['Furnify', '#furnify', '', 'marketing'])).toEqual(['furnify', 'marketing']);
  });

  it('reads the #tags out of text, Bangla too, once each', () => {
    expect(tagsIn(['Productive day. #smartly', 'More #Smartly and #বাজার-লিস্ট, #idea.'])).toEqual(['smartly', 'বাজার-লিস্ট', 'idea']);
    expect(tagsIn(['#a #b #c'], 2)).toEqual(['a', 'b']);
    expect(tagsIn(['no tags here', '# alone'])).toEqual([]);
  });

  it('accepts letters, digits, _ and - in a tag, and nothing else', () => {
    expect(TAG_PATTERN.test('land_guide-2')).toBe(true);
    expect(TAG_PATTERN.test('স্বাস্থ্য')).toBe(true);
    expect(TAG_PATTERN.test('two words')).toBe(false);
    expect(TAG_PATTERN.test('a'.repeat(31))).toBe(false);
  });
});

describe('dates', () => {
  it('bounds a month for a date column', () => {
    expect(monthBounds('2026-10')).toEqual({ start: new Date('2026-10-01T00:00:00.000Z'), end: new Date('2026-11-01T00:00:00.000Z') });
    expect(monthBounds('2026-12').end).toEqual(new Date('2027-01-01T00:00:00.000Z'));
  });

  it('knows a real calendar day', () => {
    expect(isCalendarDay('2026-02-28')).toBe(true);
    expect(isCalendarDay('2026-02-30')).toBe(false);
    expect(isCalendarDay('2026-2-3')).toBe(false);
  });
});
