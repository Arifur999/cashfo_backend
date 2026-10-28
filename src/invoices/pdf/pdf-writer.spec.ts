import { isWinAnsiText, PdfDocument, pdfString, textWidth, toWinAnsi, wrapText } from './pdf-writer.js';

// The byte offsets the xref table claims for each object.
function xrefOffsets(pdf: Buffer): number[] {
  const text = pdf.toString('latin1');
  const start = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)?.[1]);
  const table = text.slice(start);
  const [, count] = /^xref\n0 (\d+)\n/.exec(table) ?? [];
  const entries = table.split('\n').slice(2, 2 + Number(count));
  return entries.slice(1).map((entry) => Number(entry.slice(0, 10)));
}

describe('PdfDocument', () => {
  const build = () => {
    const doc = new PdfDocument();
    doc.addPage().text(50, 60, 'Hello (world) \\ back').line(50, 70, 200, 70).rect(50, 80, 100, 20, [0.1, 0.5, 0.4]);
    doc.addPage().text(50, 60, 'Page two', { font: 'bold', size: 14 });
    return doc.toBuffer({ title: 'Invoice INV-2026-000001', producer: 'Smartly' });
  };

  it('writes a PDF 1.4 header, a binary comment and the trailer', () => {
    const pdf = build();
    const text = pdf.toString('latin1');
    expect(text.startsWith('%PDF-1.4\n%')).toBe(true);
    expect([...pdf.subarray(10, 14)].every((byte) => byte > 127)).toBe(true);
    expect(text).toMatch(/trailer\n<< \/Size 10 \/Root 1 0 R \/Info 5 0 R >>\nstartxref\n\d+\n%%EOF\n$/);
  });

  it('points every xref entry at the start of its object, and startxref at the table', () => {
    const pdf = build();
    const text = pdf.toString('latin1');
    const offsets = xrefOffsets(pdf);
    expect(offsets).toHaveLength(9);
    offsets.forEach((offset, index) => expect(text.slice(offset, offset + `${index + 1} 0 obj`.length)).toBe(`${index + 1} 0 obj`));
    const start = Number(/startxref\n(\d+)/.exec(text)?.[1]);
    expect(text.slice(start, start + 4)).toBe('xref');
    // Each entry is exactly 20 bytes.
    expect(text.slice(start).split('\n')[2]).toBe('0000000000 65535 f ');
  });

  it('gives each content stream its byte length and uses the standard fonts', () => {
    const text = build().toString('latin1');
    for (const match of text.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
      const begin = (match.index ?? 0) + match[0].length;
      expect(text.slice(begin + Number(match[1]), begin + Number(match[1]) + 10)).toBe('\nendstream');
    }
    expect(text).toContain('/BaseFont /Helvetica /Encoding /WinAnsiEncoding');
    expect(text).toContain('/BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding');
    expect(text).toContain('/Count 2');
  });

  it('turns top-left coordinates into PDF ones', () => {
    const doc = new PdfDocument();
    const page = doc.addPage(600, 800);
    page.rect(10, 20, 30, 40, [1, 0, 0]);
    expect(page.ops[0]).toBe('q 1 0 0 rg 10 740 30 40 re f Q');
  });

  it('is still a valid file with no pages added', () => {
    expect(new PdfDocument().toBuffer().toString('latin1')).toContain('/Count 1');
  });
});

describe('PDF text', () => {
  it('escapes ( ) and \\ in a string', () => {
    expect(pdfString('a (b) \\ c')).toBe('(a \\(b\\) \\\\ c)');
  });

  it('writes WinAnsi bytes above ASCII as octal escapes', () => {
    expect(pdfString('Café – 5')).toBe('(Caf\\351 \\226 5)');
  });

  it('prints the taka sign as Tk and anything else it cannot show as ?', () => {
    expect(pdfString('৳ 299')).toBe('(Tk 299)');
    expect(pdfString('নুসরাত')).toMatch(/^\(\?+\)$/);
    expect(toWinAnsi('a😀b')).toEqual([0x61, 0x3f, 0x62]);
    expect(toWinAnsi('a\nb\tc')).toEqual([0x61, 0x20, 0x62, 0x20, 0x63]);
  });

  it('tells text the fonts can show from text they cannot', () => {
    expect(isWinAnsiText('Nusrat Jahan')).toBe(true);
    expect(isWinAnsiText('José ৳')).toBe(true);
    expect(isWinAnsiText('নুসরাত জাহান')).toBe(false);
  });

  it('measures with the font metrics and wraps on words', () => {
    expect(textWidth('0', 'regular', 10)).toBeCloseTo(5.56);
    expect(textWidth('i', 'bold', 10)).toBeCloseTo(2.78);
    expect(textWidth('ii', 'regular', 1000)).toBe(444);
    const lines = wrapText('one two three four five six', 'regular', 10, 60);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(' ')).toBe('one two three four five six');
    lines.forEach((line) => expect(textWidth(line, 'regular', 10)).toBeLessThanOrEqual(60));
  });
});
