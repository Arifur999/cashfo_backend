import { describe, expect, it } from 'vitest';
import { GOAL_COLORS, goalColorAt } from './goal-colors.js';

describe('goalColorAt', () => {
  it('keeps a goal its own colour, lowercased', () => {
    expect(goalColorAt('#2F5D8A', 0)).toBe('#2f5d8a');
  });

  it('gives a goal without a colour the one its place in the list gives it', () => {
    expect(goalColorAt(null, 0)).toBe(GOAL_COLORS[0]);
    expect(goalColorAt(undefined, 4)).toBe(GOAL_COLORS[4]);
    expect(goalColorAt('', GOAL_COLORS.length + 1)).toBe(GOAL_COLORS[1]);
  });

  it('ignores a colour that is not one of the goal colours', () => {
    expect(goalColorAt('#ff0000', 2)).toBe(GOAL_COLORS[2]);
  });
});
