import { describe, expect, it } from 'vitest';
import { dayLabel, renderStatementPdf, statementFileName, statementRowText, takaLabel } from './savings-statement-pdf.js';

describe('takaLabel', () => {
  it('groups in lakhs and shows paisa only when there are some', () => {
    expect(takaLabel('1250000.00')).toBe('TK 12,50,000');
    expect(takaLabel('2699.10')).toBe('TK 2,699.10');
    expect(takaLabel(0)).toBe('TK 0');
    expect(takaLabel(-500)).toBe('-TK 500');
  });
});

describe('dayLabel', () => {
  it('reads a day or a date at midnight', () => {
    expect(dayLabel('2026-10-05')).toBe('5 Oct 2026');
    expect(dayLabel(new Date('2026-01-31T00:00:00.000Z'))).toBe('31 Jan 2026');
  });
});

describe('statementRowText', () => {
  const row = { date: new Date('2026-10-05'), from: 'Exim bank', to: 'Islami Bank DPS', notes: 'October', moneyIn: '100.00', moneyOut: null, balance: '100.00' };
  it('words each kind of row', () => {
    expect(statementRowText({ ...row, kind: 'ADDED' }, 'Hajj')).toEqual({ details: 'Money added - October', from: 'Exim bank', to: 'Islami Bank DPS' });
    expect(statementRowText({ ...row, kind: 'MOVED_IN', from: 'Laptop' }, 'Hajj')).toMatchObject({ from: 'Laptop (goal)', to: 'Hajj' });
    expect(statementRowText({ ...row, kind: 'MOVED_OUT', to: 'Laptop' }, 'Hajj')).toMatchObject({ from: 'Hajj', to: 'Laptop (goal)' });
    expect(statementRowText({ ...row, kind: 'ALREADY_SAVED', notes: null }, 'Hajj').from).toBe('Already saved');
  });
  it("says a Bangla name can't be drawn instead of printing question marks", () => {
    expect(statementRowText({ ...row, kind: 'ADDED', from: 'নগদ', notes: null }, 'Hajj').from).toBe('(name in Bangla)');
  });
});

describe('renderStatementPdf', () => {
  it('makes a PDF, over more than one page when the rows need it', () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({ date: new Date('2026-10-05'), kind: 'ADDED' as const, from: 'Cash', to: 'DPS', notes: null, moneyIn: '100.00', moneyOut: null, balance: String((i + 1) * 100) }));
    const pdf = renderStatementPdf({
      platformName: 'Smartly',
      person: { name: 'Khaled', email: 'k@example.com' },
      goal: { name: 'Hajj', targetAmount: '300000.00', targetDate: new Date('2028-12-31'), startDate: '2026-08-15', status: 'ON_TRACK' },
      today: '2026-10-31',
      rows,
      totals: { opening: '0.00', moneyIn: '6000.00', moneyOut: '0.00', balance: '6000.00' },
      sources: [{ kind: 'ACCOUNT', name: 'Cash', amount: '6000.00' }],
      now: [{ name: 'DPS', amount: '6000.00' }],
    });
    const text = pdf.toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(Number(/\/Count (\d+)/.exec(text)?.[1])).toBeGreaterThan(1);
  });
});

describe('statementFileName', () => {
  it('keeps the name to safe characters', () => {
    expect(statementFileName('Umrah trip!', '2026-10-31')).toBe('Smartly_Umrah-trip_statement_2026-10-31.pdf');
    expect(statementFileName('হজ', '2026-10-31')).toBe('Smartly_goal_statement_2026-10-31.pdf');
  });
});
