import { cleanNote, cleanSteps, stepsOf, unticked } from './todo-text.js';

describe('todo-text', () => {
  it('keeps a note on its lines, trimmed, and empties an invisible one', () => {
    expect(cleanNote('  one\r\ntwo\rthree  ')).toBe('one\ntwo\nthree');
    expect(cleanNote('\u200b \n ')).toBe('');
    expect(() => cleanNote('x'.repeat(1001))).toThrow("can't be longer");
  });

  it('cleans each step and refuses an empty one', () => {
    expect(cleanSteps([{ text: '  Book   the bus ', done: true }])).toEqual([{ text: 'Book the bus', done: true }]);
    expect(() => cleanSteps([{ text: '\u200b', done: false }])).toThrow('A step needs some words');
  });

  it('reads stored steps defensively', () => {
    expect(stepsOf([{ text: 'a', done: false }, { text: 1, done: true }, 'junk', null, { text: 'b', done: true }])).toEqual([
      { text: 'a', done: false },
      { text: 'b', done: true },
    ]);
    expect(stepsOf({ text: 'a' })).toEqual([]);
    expect(stepsOf(null)).toEqual([]);
  });

  it('unticks every step for a repeat copy', () => {
    expect(unticked([{ text: 'a', done: true }])).toEqual([{ text: 'a', done: false }]);
  });
});
