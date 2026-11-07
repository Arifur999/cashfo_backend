import { describe, expect, it } from 'vitest';
import { unzip } from '../../test/unzip.js';
import { columnName, sheetNames, xlsxWorkbook } from './xlsx.js';

describe('xlsxWorkbook', () => {
  it('writes a workbook with a sheet per table, amounts as numbers and text as text', () => {
    const files = unzip(
      xlsxWorkbook([
        { name: 'Personal · transactions', head: ['Date', 'Amount', 'Note', 'Phone'], rows: [['2026-11-05', 2350.5, 'Bazar & <fish>', '01711000000']] },
        { name: 'দোকান · wallets', head: ['Name', 'Active'], rows: [['নগদ', true]] },
      ]),
    );
    expect(Object.keys(files)).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml',
    ]);
    expect(files['xl/workbook.xml']).toContain('<sheet name="Personal · transactions" sheetId="1" r:id="rId1"/>');
    expect(files['xl/workbook.xml']).toContain('<sheet name="দোকান · wallets" sheetId="2" r:id="rId2"/>');
    const sheet = files['xl/worksheets/sheet1.xml'];
    expect(sheet).toContain('<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">Date</t></is></c>');
    expect(sheet).toContain('<c r="B2"><v>2350.5</v></c>');
    expect(sheet).toContain('Bazar &amp; &lt;fish&gt;');
    expect(sheet).toContain('<c r="D2" t="inlineStr"><is><t xml:space="preserve">01711000000</t></is></c>');
    expect(files['xl/worksheets/sheet2.xml']).toContain('<c r="B2" t="b"><v>1</v></c>');
  });

  it('names columns and sheets the way Excel wants them', () => {
    expect([0, 25, 26, 51, 52, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AZ', 'BA', 'ZZ', 'AAA']);
    expect(sheetNames(['a/b', 'A-B', 'x'.repeat(40), 'x'.repeat(40)])).toEqual(['a-b', 'A-B (2)', 'x'.repeat(31), `${'x'.repeat(27)} (2)`]);
  });
});
