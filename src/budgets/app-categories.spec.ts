import { describe, expect, it } from 'vitest';
import { CHARGE_CATEGORIES, isReservedCategoryName, OTHER_CHARGE_CATEGORY } from './app-categories.js';

describe('charge categories', () => {
  it('files a charge under Other without reserving the name', () => {
    expect(CHARGE_CATEGORIES).toContain(OTHER_CHARGE_CATEGORY);
    expect(isReservedCategoryName('Other')).toBe(false);
    expect(isReservedCategoryName('bank charge')).toBe(true);
  });
});
