import { describe, expect, it } from 'vitest';
import { canSolve } from './solve.js';

describe('canSolve', () => {
  it('lets an open, answered or solved conversation be marked solved', () => {
    for (const status of ['OPEN', 'IN_PROGRESS', 'WAITING_ON_USER', 'RESOLVED'] as const) expect(canSolve(status)).toBe(true);
  });

  it('refuses a closed one', () => {
    expect(canSolve('CLOSED')).toBe(false);
  });
});
