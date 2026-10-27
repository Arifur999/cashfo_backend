import { areSignupsOpen, signupsOpenFrom } from './signups.js';

describe('signupsOpenFrom', () => {
  it('is closed only for an explicit false', () => {
    expect(signupsOpenFrom(false)).toBe(false);
    expect(signupsOpenFrom(true)).toBe(true);
    expect(signupsOpenFrom(undefined)).toBe(true);
    expect(signupsOpenFrom(null)).toBe(true);
    expect(signupsOpenFrom('false')).toBe(true);
  });
});

describe('areSignupsOpen', () => {
  it('reads the signups_open row', async () => {
    const findUnique = vi.fn().mockResolvedValue({ value: false });
    await expect(areSignupsOpen({ platformSetting: { findUnique } })).resolves.toBe(false);
    expect(findUnique).toHaveBeenCalledWith({ where: { key: 'signups_open' }, select: { value: true } });
  });

  it('is open when the row is missing', async () => {
    await expect(areSignupsOpen({ platformSetting: { findUnique: vi.fn().mockResolvedValue(null) } })).resolves.toBe(true);
  });
});
