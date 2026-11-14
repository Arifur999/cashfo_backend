import {
  assetZakatOf,
  daysBetween,
  debtWithinYearPaisa,
  dueDateFor,
  hijriOf,
  investmentCapitalPaisa,
  metalValuePaisa,
  monthlyParts,
  nextCustomDate,
  nisabPaisa,
  pricesPerVori,
  zakatPaisa,
} from './zakat-rules.js';

describe('prices and nisab', () => {
  it('prices every karat from the 22 karat gold price, as BAJUS does', () => {
    expect(pricesPerVori(217592, 3499)).toEqual({ GOLD_22: 217592, GOLD_21: 207794, GOLD_18: 178459, GOLD_TRADITIONAL: 145800, SILVER_22: 3499 });
    // A new gold price moves the other karats with it.
    expect(pricesPerVori(200000, 3000).GOLD_21).toBe(Math.round((207794 * 200000) / 217592));
  });

  it('values gold by weight, and works out nisab on silver or gold', () => {
    expect(metalValuePaisa(2, 217592)).toBe(43518400);
    expect(metalValuePaisa(1.5, 3499)).toBe(524850);
    // 52.5 vori silver = ৳ 1,83,697.50; 7.5 vori gold = ৳ 16,31,940.
    expect(nisabPaisa('SILVER', 217592, 3499)).toBe(18369750);
    expect(nisabPaisa('GOLD', 217592, 3499)).toBe(163194000);
  });

  it('is 2.5 % of what is owned after debts, and nothing below nisab', () => {
    const nisab = nisabPaisa('SILVER', 217592, 3499);
    expect(zakatPaisa(114193400, nisab)).toBe(2854835); // ৳ 11,41,934 -> ৳ 28,548.35
    expect(zakatPaisa(nisab - 1, nisab)).toBe(0);
    expect(zakatPaisa(nisab, nisab)).toBe(Math.round(nisab * 0.025));
    expect(zakatPaisa(-5000, nisab)).toBe(0);
  });
});

describe('the zakat date', () => {
  it('finds the next 1 Ramadan and 1 Muharram on the Umm al-Qura calendar', () => {
    expect(dueDateFor('RAMADAN', null, '2026-11-02')).toEqual({ date: '2027-02-08', hijriYear: 1448 });
    expect(dueDateFor('MUHARRAM', null, '2026-11-02')).toEqual({ date: '2027-06-06', hijriYear: 1449 });
    // On the day itself it is due today.
    expect(dueDateFor('RAMADAN', null, '2027-02-08').date).toBe('2027-02-08');
    expect(hijriOf('2027-02-08')).toEqual({ year: 1448, month: 9, day: 1 });
  });

  it('repeats a custom date every year, and 29 Feb falls back to 28 Feb', () => {
    expect(nextCustomDate('2026-11-02', '2027-01-15')).toBe('2027-01-15');
    expect(nextCustomDate('2026-11-02', '2026-12-01')).toBe('2026-12-01');
    expect(nextCustomDate('2026-11-02', '2025-03-10')).toBe('2027-03-10');
    expect(nextCustomDate('2026-11-02', '2028-02-29')).toBe('2027-02-28');
    expect(dueDateFor('CUSTOM', '2027-01-15', '2026-11-02')).toEqual({ date: '2027-01-15', hijriYear: null });
    // CUSTOM with no date falls back to Ramadan.
    expect(dueDateFor('CUSTOM', null, '2026-11-02').date).toBe('2027-02-08');
  });

  it('splits what is left into monthly parts until the date', () => {
    expect(daysBetween('2026-11-02', '2027-02-08')).toBe(98);
    expect(monthlyParts(2854800, 98)).toEqual({ parts: 4, perPart: 713700 });
    expect(monthlyParts(2854800, 10)).toEqual({ parts: 1, perPart: 2854800 });
    expect(monthlyParts(0, 98)).toEqual({ parts: 4, perPart: 0 });
  });
});

describe('assets and debts', () => {
  it('sorts asset categories into gold, investments or not counted', () => {
    expect(assetZakatOf('Jewellery')).toBe('GOLD');
    expect(assetZakatOf('গয়না')).toBe('GOLD');
    expect(assetZakatOf('Investment')).toBe('INVESTMENTS');
    expect(assetZakatOf('Shares')).toBe('INVESTMENTS');
    expect(assetZakatOf('Land')).toBe('NOT_COUNTED');
    expect(assetZakatOf('Vehicle')).toBe('NOT_COUNTED');
  });

  it('takes off only what falls due within 12 months', () => {
    const today = '2026-11-02';
    const parts = [
      { remainingPaisa: 500000, dueDate: '2026-12-01' },
      { remainingPaisa: 2000000, dueDate: '2030-01-01' },
      { remainingPaisa: 100000, dueDate: null },
      { remainingPaisa: 0, dueDate: '2026-11-10' },
    ];
    expect(debtWithinYearPaisa(300000, parts, today)).toBe(900000);
    expect(debtWithinYearPaisa(0, [], today)).toBe(0);
  });
});

describe('investments', () => {
  it('counts the capital still in an investment: put in, less what came back and what was lost, not the profit', () => {
    const d = (day: string) => new Date(`${day}T00:00:00Z`);
    const entries = [
      { type: 'INVEST' as const, amount: '500000.00', date: d('2025-02-01') },
      { type: 'ADD' as const, amount: 20000, date: d('2025-06-01') },
      { type: 'PROFIT' as const, amount: '45000.50', date: d('2026-02-01') },
      { type: 'BACK' as const, amount: '100000', date: d('2026-03-01') },
      { type: 'LOSS' as const, amount: '0.25', date: d('2026-04-01') },
    ];
    expect(investmentCapitalPaisa(entries)).toBe(41999975);
    expect(investmentCapitalPaisa([])).toBe(0);
  });
});
