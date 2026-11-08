import { describe, expect, it } from 'vitest';
import { checkPractice, checkTarget, cleanLink, moveShelf, noteTitle, practiceRuns, progressOf } from './skill-rules.js';

describe('cleanLink', () => {
  it('adds https and takes only a web address', () => {
    expect(cleanLink('udemy.com/course/react')).toBe('https://udemy.com/course/react');
    expect(cleanLink('http://react.dev')).toBe('http://react.dev');
    expect(cleanLink('  ')).toBe('');
    expect(() => cleanLink('not a link')).toThrow('Write a full link, like https://udemy.com');
    expect(() => cleanLink('javascript:alert(1)')).toThrow('Write a full link');
  });
});

describe('noteTitle', () => {
  it('keeps a title, else takes the first line cut at a word', () => {
    expect(noteTitle('Hooks', 'text')).toBe('Hooks');
    expect(noteTitle('', 'Custom hooks\nmore')).toBe('Custom hooks');
    expect(noteTitle('', 'A custom hook is just a function that starts with use and calls other hooks')).toBe('A custom hook is just a function that starts…');
  });
});

describe('progress and limits', () => {
  it('counts what came before and every day logged, up to the target', () => {
    expect(progressOf('LEARNING', 40, 4, 14)).toBe(18);
    expect(progressOf('LEARNING', 40, 30, 14)).toBe(40);
    expect(progressOf('COMPLETED', 40, 0, 3)).toBe(40);
  });

  it('caps a target per unit', () => {
    expect(() => checkTarget('LESSONS', 5001)).toThrow('A skill can have up to 5000 lessons or chapters');
    expect(() => checkTarget('HOURS', 300001)).toThrow('A goal can be up to 5000 hours');
    expect(() => checkTarget('CHAPTERS', 5000)).not.toThrow();
  });

  it('keeps a day of practice inside the day and the course', () => {
    expect(() => checkPractice('HOURS', 1441, 600, 0)).toThrow('A day has only 1440 minutes');
    expect(() => checkPractice('HOURS', 120, 60, 60)).not.toThrow();
    expect(() => checkPractice('LESSONS', 3, 40, 38)).toThrow('Only 2 lessons are left in this skill');
    expect(() => checkPractice('CHAPTERS', 1, 10, 10)).toThrow('All chapters are already done. Mark the skill completed instead');
    expect(() => checkPractice('LESSONS', 2, 40, 38)).not.toThrow();
  });
});

describe('moveShelf', () => {
  const now = new Date('2026-11-08T08:00:00.000Z');
  const earlier = new Date('2026-10-01T08:00:00.000Z');
  const learning = { status: 'LEARNING' as const, pausedAt: null, startedAt: earlier, completedAt: null };

  it('starts, completes and learns again with the dates following', () => {
    expect(moveShelf({ status: 'WANT_TO_LEARN', pausedAt: null, startedAt: null, completedAt: null }, { status: 'LEARNING' }, now)).toEqual({
      ...learning,
      startedAt: now,
    });
    expect(moveShelf(learning, { status: 'COMPLETED' }, now)).toEqual({ status: 'COMPLETED', pausedAt: null, startedAt: earlier, completedAt: now });
    expect(moveShelf({ status: 'COMPLETED', pausedAt: null, startedAt: earlier, completedAt: now }, { status: 'LEARNING' }, now)).toEqual(learning);
  });

  it('pauses only a skill being learned, keeping the first pause', () => {
    expect(moveShelf(learning, { paused: true }, now).pausedAt).toBe(now);
    expect(moveShelf({ ...learning, pausedAt: earlier }, { paused: true }, now).pausedAt).toBe(earlier);
    expect(moveShelf({ ...learning, pausedAt: earlier }, { paused: false }, now).pausedAt).toBeNull();
    expect(() => moveShelf({ status: 'WANT_TO_LEARN', pausedAt: null, startedAt: null, completedAt: null }, { paused: true }, now)).toThrow(
      'Only a skill being learned can be paused',
    );
    // Moving to learning and pausing in one go (the form's "Paused").
    expect(moveShelf({ status: 'WANT_TO_LEARN', pausedAt: null, startedAt: null, completedAt: null }, { status: 'LEARNING', paused: true }, now)).toMatchObject(
      { status: 'LEARNING', pausedAt: now },
    );
  });
});

describe('practiceRuns', () => {
  it('counts the run up to today, or yesterday while today has none, and the best run', () => {
    const days = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-11-06', '2026-11-07'];
    expect(practiceRuns(days, '2026-11-08')).toEqual({ streak: 2, best: 3 });
    expect(practiceRuns([...days, '2026-11-08'], '2026-11-08')).toEqual({ streak: 3, best: 3 });
    expect(practiceRuns([], '2026-11-08')).toEqual({ streak: 0, best: 0 });
  });
});
