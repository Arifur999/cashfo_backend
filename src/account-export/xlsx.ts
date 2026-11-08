import { cellText, type CsvCell } from './csv.js';
import { zipFiles } from './zip.js';

export interface SheetData {
  name: string;
  head: string[];
  rows: CsvCell[][];
}

// Characters XML 1.0 can't carry at all, and the ones it must escape.
// eslint-disable-next-line no-control-regex
const NOT_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
const xml = (text: string) => text.replace(NOT_XML, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// A1-style column letters: 0 -> A, 25 -> Z, 26 -> AA.
export function columnName(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

// A sheet name Excel takes: at most 31 characters, none of []:*?/\, and
// unique in the workbook regardless of case.
export function sheetNames(wanted: string[]): string[] {
  const used = new Set<string>();
  return wanted.map((raw) => {
    const base =
      raw
        .replace(/[[\]:*?/\\]/g, '-')
        .replace(NOT_XML, '')
        .trim()
        .slice(0, 31) || 'Sheet';
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, 31 - String(n).length - 3)} (${n})`;
    used.add(name.toLowerCase());
    return name;
  });
}

// Amounts (numbers, money) as numbers a spreadsheet can add up; everything
// else, phone and account numbers included, as the text it is.
function cell(value: CsvCell, ref: string, style = 0): string {
  const s = style ? ` s="${style}"` : '';
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"${s}><v>${value}</v></c>`;
  if (typeof value === 'object' && !(value instanceof Date)) return `<c r="${ref}"${s}><v>${value.toFixed(2)}</v></c>`;
  if (typeof value === 'boolean') return `<c r="${ref}"${s} t="b"><v>${value ? 1 : 0}</v></c>`;
  const text = value instanceof Date ? value.toISOString() : String(value);
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xml(text)}</t></is></c>`;
}

function worksheet(sheet: SheetData): string {
  const widths = sheet.head.map((title, col) => Math.min(50, Math.max(title.length, ...sheet.rows.slice(0, 200).map((row) => cellText(row[col]).length)) + 2));
  const rows = [
    `<row r="1">${sheet.head.map((title, col) => cell(title, `${columnName(col)}1`, 1)).join('')}</row>`,
    ...sheet.rows.map((row, i) => `<row r="${i + 2}">${row.map((value, col) => cell(value, `${columnName(col)}${i + 2}`)).join('')}</row>`),
  ];
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>',
    widths.length > 0 ? `<cols>${widths.map((width, col) => `<col min="${col + 1}" max="${col + 1}" width="${width}" customWidth="1"/>`).join('')}</cols>` : '',
    `<sheetData>${rows.join('')}</sheetData>`,
    '</worksheet>',
  ].join('');
}

// One Excel workbook (.xlsx), a sheet per table, the header row bold and
// kept in view. Written by hand: a workbook is a .zip of a few XML files.
export function xlsxWorkbook(sheets: SheetData[], now: Date = new Date()): Buffer {
  const list = sheets.length > 0 ? sheets : [{ name: 'Smartly', head: [], rows: [] }];
  const names = sheetNames(list.map((sheet) => sheet.name));
  const files = [
    {
      name: '[Content_Types].xml',
      text: [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
        '<Default Extension="xml" ContentType="application/xml"/>',
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
        ...list.map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        ),
        '</Types>',
      ].join(''),
    },
    {
      name: '_rels/.rels',
      text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    },
    {
      name: 'xl/workbook.xml',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((name, i) => `<sheet name="${xml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${list.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    {
      name: 'xl/styles.xml',
      text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>',
    },
    ...list.map((sheet, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, text: worksheet(sheet) })),
  ];
  return zipFiles(
    files.map((file) => ({ name: file.name, data: Buffer.from(file.text, 'utf8') })),
    now,
  );
}
