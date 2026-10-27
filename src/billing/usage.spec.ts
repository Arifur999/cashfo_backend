import { leftOf, planLimits } from './usage.js';

describe('planLimits', () => {
  it("reads the free plan's limits", () => {
    expect(planLimits({ maxWorkspaces: 1, maxTransactionsPerMonth: 50, pdfExport: false })).toEqual({
      transactionLimit: 50,
      workspaceLimit: 1,
      pdfExport: false,
    });
  });

  it('reads -1, a missing number or junk as no limit', () => {
    expect(planLimits({ maxTransactionsPerMonth: -1, pdfExport: true })).toEqual({ transactionLimit: -1, workspaceLimit: -1, pdfExport: true });
    expect(planLimits(null)).toEqual({ transactionLimit: -1, workspaceLimit: -1, pdfExport: false });
    expect(planLimits({ maxTransactionsPerMonth: '50', pdfExport: 'yes' })).toEqual({ transactionLimit: -1, workspaceLimit: -1, pdfExport: false });
  });
});

describe('leftOf', () => {
  it('says how many are left, never below 0, and null with no limit', () => {
    expect(leftOf(41, 50)).toBe(9);
    expect(leftOf(60, 50)).toBe(0);
    expect(leftOf(41, -1)).toBeNull();
  });
});
