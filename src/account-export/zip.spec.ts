import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { day, toCsv } from './csv.js';
import { zipFiles } from './zip.js';

// Reads the archive back the way an unzip tool would: the central
// directory, then each file's local header and its deflated bytes.
function unzip(zip: Buffer): Record<string, string> {
  const end = zip.length - 22;
  expect(zip.readUInt32LE(end)).toBe(0x06054b50);
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const files: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(at)).toBe(0x02014b50);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const offset = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    const localNameLength = zip.readUInt16LE(offset + 26);
    const start = offset + 30 + localNameLength;
    files[name] = inflateRawSync(zip.subarray(start, start + size)).toString('utf8');
    at += 46 + nameLength;
  }
  return files;
}

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
    const text = toCsv(['Name', 'Amount', 'Note'], [['Rahim, Karim', -500, '=HYPERLINK("x")'], ['Line\nbreak', '1200.50', '-5 off']]).toString('utf8');
    expect(text).toBe('﻿Name,Amount,Note\r\n"Rahim, Karim",-500,"\'=HYPERLINK(""x"")"\r\n"Line\nbreak",1200.50,\'-5 off\r\n');
  });

  it('writes a date column as the day', () => {
    expect(day(new Date('2026-10-05T00:00:00.000Z'))).toBe('2026-10-05');
    expect(day(null)).toBe('');
  });
});
