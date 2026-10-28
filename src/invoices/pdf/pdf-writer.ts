// A small PDF 1.4 writer for the invoice: text in the two standard
// Helvetica fonts, lines and filled rectangles, nothing else. The standard
// fonts are built into every PDF reader, so nothing is embedded and no
// library is needed. They only know WinAnsi (Windows-1252), so text is
// mapped to it first: the taka sign becomes "Tk" and anything else it
// can't show (Bangla, emoji) becomes "?" instead of breaking the file.

export type PdfFont = 'regular' | 'bold';
export type PdfColor = [number, number, number];

const BASE_FONTS: Record<PdfFont, { name: string; base: string }> = {
  regular: { name: 'F1', base: 'Helvetica' },
  bold: { name: 'F2', base: 'Helvetica-Bold' },
};

// Windows-1252's 0x80-0x9F block, by Unicode code point. 0xA0-0xFF match
// Latin-1 and 0x20-0x7E match ASCII.
const WIN_ANSI_HIGH: Record<number, number> = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
};

// Stand-ins for characters people type that WinAnsi lacks.
const SUBSTITUTES: Record<string, string> = { '৳': 'Tk', '−': '-', ' ': ' ', ' ': ' ', ' ': ' ' };

// The WinAnsi byte for one character, or null when it has none.
export function winAnsiByte(char: string): number | null {
  const code = char.codePointAt(0) ?? 0;
  if (code >= 0x20 && code <= 0x7e) return code;
  if (code >= 0xa0 && code <= 0xff) return code;
  return WIN_ANSI_HIGH[code] ?? null;
}

// Text as WinAnsi bytes: substitutes first, then "?" for whatever is left
// over. Tabs and line breaks become spaces (a line is drawn by the caller).
export function toWinAnsi(text: string): number[] {
  const bytes: number[] = [];
  for (const char of text.normalize('NFC')) {
    const substitute = SUBSTITUTES[char] ?? (/\s/.test(char) ? ' ' : null);
    if (substitute !== null) {
      for (const sub of substitute) bytes.push(sub.charCodeAt(0));
      continue;
    }
    bytes.push(winAnsiByte(char) ?? 0x3f);
  }
  return bytes;
}

// Whether every character of the text shows as itself (the taka sign and
// spaces count), so a caller can pick a better fallback than "?"s.
export function isWinAnsiText(text: string): boolean {
  for (const char of text.normalize('NFC')) {
    if (SUBSTITUTES[char] === undefined && !/\s/.test(char) && winAnsiByte(char) === null) return false;
  }
  return true;
}

// A PDF literal string: ( ) and \ are escaped, bytes outside printable
// ASCII are written as octal escapes so the content stream stays ASCII.
export function pdfString(text: string): string {
  let out = '(';
  for (const byte of toWinAnsi(text)) {
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out += `\\${String.fromCharCode(byte)}`;
    else if (byte < 0x20 || byte > 0x7e) out += `\\${byte.toString(8).padStart(3, '0')}`;
    else out += String.fromCharCode(byte);
  }
  return `${out})`;
}

// Glyph widths (per 1000 units of the font size) for 0x20-0x7E, from the
// Adobe font metrics of the two fonts.
// prettier-ignore
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
// prettier-ignore
const HELVETICA_BOLD_WIDTHS = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];
// A few common characters above ASCII; the rest are taken as a digit's
// width, close enough for lining up a column.
const HIGH_WIDTHS: Record<number, number> = { 0x95: 350, 0x96: 556, 0x97: 1000, 0xb7: 278, 0x85: 1000, 0x91: 222, 0x92: 222, 0x93: 333, 0x94: 333 };

export function textWidth(text: string, font: PdfFont, size: number): number {
  const table = font === 'bold' ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS;
  let units = 0;
  for (const byte of toWinAnsi(text)) units += byte >= 0x20 && byte <= 0x7e ? table[byte - 0x20] : (HIGH_WIDTHS[byte] ?? 556);
  return (units * size) / 1000;
}

// Words onto lines no wider than maxWidth. A single word longer than a
// line is left whole (it runs over rather than being cut).
export function wrapText(text: string, font: PdfFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next, font, size) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Numbers as PDF writes them: at most two decimals, no exponent.
const num = (value: number) => {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? '0' : String(rounded);
};
const color = (rgb: PdfColor) => rgb.map((part) => num(Math.min(1, Math.max(0, part)))).join(' ');

export interface TextOptions {
  font?: PdfFont;
  size?: number;
  color?: PdfColor;
  // x is the left edge, the right edge, or the middle of the text.
  align?: 'left' | 'right' | 'center';
}

// One page. Coordinates are in points from the TOP-left corner (y grows
// down, like the screen); the page turns them into PDF's bottom-left ones.
export class PdfPage {
  readonly ops: string[] = [];

  constructor(
    readonly width: number,
    readonly height: number,
  ) {}

  // y is the text's baseline.
  text(x: number, y: number, text: string, options: TextOptions = {}): this {
    const font = options.font ?? 'regular';
    const size = options.size ?? 10;
    const width = textWidth(text, font, size);
    const left = options.align === 'right' ? x - width : options.align === 'center' ? x - width / 2 : x;
    this.ops.push(
      `BT /${BASE_FONTS[font].name} ${num(size)} Tf ${color(options.color ?? [0, 0, 0])} rg ${num(left)} ${num(this.height - y)} Td ${pdfString(text)} Tj ET`,
    );
    return this;
  }

  line(x1: number, y1: number, x2: number, y2: number, options: { width?: number; color?: PdfColor } = {}): this {
    this.ops.push(
      `q ${num(options.width ?? 1)} w ${color(options.color ?? [0, 0, 0])} RG ${num(x1)} ${num(this.height - y1)} m ${num(x2)} ${num(this.height - y2)} l S Q`,
    );
    return this;
  }

  // x, y is the top-left corner.
  rect(x: number, y: number, width: number, height: number, fill: PdfColor): this {
    this.ops.push(`q ${color(fill)} rg ${num(x)} ${num(this.height - y - height)} ${num(width)} ${num(height)} re f Q`);
    return this;
  }
}

// A4 in points.
export const A4 = { width: 595.28, height: 841.89 };

export class PdfDocument {
  private readonly pages: PdfPage[] = [];

  addPage(width = A4.width, height = A4.height): PdfPage {
    const page = new PdfPage(width, height);
    this.pages.push(page);
    return page;
  }

  // The finished file. Objects: 1 catalog, 2 page tree, 3-4 the fonts,
  // 5 the document info, then a page and its content stream per page.
  toBuffer(info: { title?: string; producer?: string } = {}): Buffer {
    const pages = this.pages.length > 0 ? this.pages : [new PdfPage(A4.width, A4.height)];
    const pageIds = pages.map((_, index) => 6 + index * 2);
    const infoEntries = [
      info.title ? `/Title ${pdfString(info.title)}` : '',
      info.producer ? `/Producer ${pdfString(info.producer)}` : '',
      `/CreationDate (D:${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z)`,
    ].filter(Boolean);

    const objects: Buffer[] = [
      Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'latin1'),
      Buffer.from(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`, 'latin1'),
      ...(['regular', 'bold'] as const).map((font) =>
        Buffer.from(`<< /Type /Font /Subtype /Type1 /BaseFont /${BASE_FONTS[font].base} /Encoding /WinAnsiEncoding >>`, 'latin1'),
      ),
      Buffer.from(`<< ${infoEntries.join(' ')} >>`, 'latin1'),
    ];
    pages.forEach((page, index) => {
      const contentId = pageIds[index] + 1;
      objects.push(
        Buffer.from(
          `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(page.width)} ${num(page.height)}] ` +
            `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`,
          'latin1',
        ),
      );
      const stream = Buffer.from(page.ops.join('\n'), 'latin1');
      objects.push(Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, 'latin1'), stream, Buffer.from('\nendstream', 'latin1')]));
    });

    // The header's second line is a comment of four high bytes, which tells
    // file tools the PDF holds binary data.
    const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
    let offset = chunks[0].length;
    const offsets: number[] = [];
    objects.forEach((body, index) => {
      offsets.push(offset);
      const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`, 'latin1'), body, Buffer.from('\nendobj\n', 'latin1')]);
      chunks.push(chunk);
      offset += chunk.length;
    });

    // Each cross-reference entry is exactly 20 bytes, ending in space + LF.
    const xref = [`xref\n0 ${objects.length + 1}\n`, '0000000000 65535 f \n', ...offsets.map((at) => `${String(at).padStart(10, '0')} 00000 n \n`)].join('');
    chunks.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${offset}\n%%EOF\n`, 'latin1'));
    return Buffer.concat(chunks);
  }
}
