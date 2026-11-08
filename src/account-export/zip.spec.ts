import { describe, expect, it } from 'vitest';
import { day, toCsv } from './csv.js';
import { zipFiles } from './zip.js';
import { unzip } from '../../test/unzip.js';

describe('zipFiles', () => {
  it('writes files an unzip tool reads back, Bangla names included', () => {
    const zip = zipFiles([
      { name: 'Personal/transactions.csv', data: Buffer.from('a,b\r\n1,2\r\n') },
      { name: 'দোকান/wallets.csv', data: Buffer.from('নগদ,500') },
    ]);
    expect(unzip(zip)).toEqual({ 'Personal/transactions.csv': 'a,b\r\n1,2\r\n', 'দোকান/wallets.csv': 'নগদ,500' });
  });
});

describe('toCsv', () => {
  it('quotes what needs quoting and keeps typed formulas as text', () => {
    const text = toCsv(
      ['Name', 'Amount', 'Note'],
      [
        ['Rahim, Karim', -500, '=HYPERLINK("x")'],
        ['Line\nbreak', '1200.50', '-5 off'],
      ],
    ).toString('utf8');
    expect(text).toBe('﻿Name,Amount,Note\r\n"Rahim, Karim",-500,"\'=HYPERLINK(""x"")"\r\n"Line\nbreak",1200.50,\'-5 off\r\n');
  });

  it('writes a date column as the day', () => {
    expect(day(new Date('2026-10-05T00:00:00.000Z'))).toBe('2026-10-05');
    expect(day(null)).toBe('');
  });
});
