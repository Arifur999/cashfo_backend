import { isWinAnsiText, PdfDocument, type PdfColor, textWidth, wrapText } from '../invoices/pdf/pdf-writer.js';

// A savings goal's statement as an A4 landscape PDF: who and which goal,
// the four totals, every movement with its running balance, where the
// money came from and where it sits now. English only: the PDF fonts have
// no Bangla, so the app offers Print for a statement with Bangla names.

export type StatementRowKind = 'ALREADY_SAVED' | 'ADDED' | 'MOVED_IN' | 'MOVED_OUT' | 'WITHDRAWN';

export interface StatementPdfInput {
  platformName: string;
  person: { name: string; email: string };
  goal: { name: string; targetAmount: string; targetDate: Date; startDate: string; status: string };
  today: string;
  rows: { date: Date; kind: StatementRowKind; from: string | null; to: string | null; notes: string | null; moneyIn: string | null; moneyOut: string | null; balance: string }[];
  totals: { opening: string; moneyIn: string; moneyOut: string; balance: string };
  sources: { kind: 'ACCOUNT' | 'ALREADY_SAVED' | 'GOAL'; name: string | null; amount: string }[];
  now: { name: string | null; amount: string }[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// '2026-10-05' (or a Date at UTC midnight) as "5 Oct 2026".
export function dayLabel(day: string | Date): string {
  const key = typeof day === 'string' ? day.slice(0, 10) : day.toISOString().slice(0, 10);
  return `${Number(key.slice(8, 10))} ${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
}

// Taka in lakh grouping, as "Tk 12,50,000" (the paisa only when there are
// some). The PDF fonts have no taka sign.
export function takaLabel(value: string | number): string {
  const amount = Number(value);
  const negative = amount < 0;
  const [whole, paisa] = Math.abs(amount).toFixed(2).split('.');
  const last = whole.slice(-3);
  const rest = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}Tk ${rest ? `${rest},${last}` : last}${paisa === '00' ? '' : `.${paisa}`}`;
}

// A name as the PDF can draw it.
const shown = (text: string | null | undefined, fallback = '-') => (text && isWinAnsiText(text) ? text : text ? '(name in Bangla)' : fallback);

const STATUS: Record<string, string> = { AHEAD: 'Ahead', ON_TRACK: 'On track', BEHIND: 'Behind', ACTIVE: 'Active', PAUSED: 'Paused', COMPLETED: 'Completed', WITHDRAWN: 'Withdrawn', ACHIEVED: 'Achieved' };

export function statementRowText(row: StatementPdfInput['rows'][number], goalName: string): { details: string; from: string; to: string } {
  const note = row.notes && isWinAnsiText(row.notes) ? ` - ${row.notes}` : '';
  switch (row.kind) {
    case 'ALREADY_SAVED':
      return { details: 'Already saved when the goal was made', from: 'Already saved', to: shown(row.to) };
    case 'ADDED':
      return { details: `Money added${note}`, from: shown(row.from), to: shown(row.to) };
    case 'MOVED_IN':
      return { details: `Moved in from another goal${note}`, from: `${shown(row.from)} (goal)`, to: shown(goalName) };
    case 'MOVED_OUT':
      return { details: `Moved out to another goal${note}`, from: shown(goalName), to: `${shown(row.to)} (goal)` };
    default:
      return { details: `Withdrawn to main balance${note}`, from: shown(row.from), to: shown(row.to) };
  }
}

const INK: PdfColor = [0.071, 0.125, 0.114];
const BODY: PdfColor = [0.29, 0.341, 0.329];
const MUTED: PdfColor = [0.373, 0.42, 0.408];
const BRAND: PdfColor = [0.11, 0.459, 0.404];
const HAIRLINE: PdfColor = [0.882, 0.906, 0.902];
const SOFT: PdfColor = [0.957, 0.961, 0.961];
const IN: PdfColor = [0.082, 0.502, 0.239];
const OUT: PdfColor = [0.725, 0.11, 0.11];

const MARGIN = 40;
const BOTTOM = 48;

// The text cut to fit a column, with "..." when it doesn't.
function fit(text: string, size: number, width: number, font: 'regular' | 'bold' = 'regular'): string {
  if (textWidth(text, font, size) <= width) return text;
  let cut = text;
  while (cut.length > 1 && textWidth(`${cut}...`, font, size) > width) cut = cut.slice(0, -1);
  return `${cut}...`;
}

export function renderStatementPdf(input: StatementPdfInput): Buffer {
  const doc = new PdfDocument();
  let page = doc.addPage(841.89, 595.28);
  const right = page.width - MARGIN;
  const width = right - MARGIN;
  let y = MARGIN;

  // Header: the platform, the title and the person; the statement's facts
  // on the right.
  page.rect(0, 0, page.width, 5, BRAND);
  page.text(MARGIN, y + 10, shown(input.platformName, 'Smartly').toUpperCase(), { font: 'bold', size: 9, color: BRAND });
  page.text(MARGIN, y + 30, 'Savings goal statement', { font: 'bold', size: 18, color: INK });
  const person = [shown(input.person.name, ''), input.person.email].filter((part) => part && part !== '(name in Bangla)').join(' - ');
  page.text(MARGIN, y + 46, person, { size: 9.5, color: BODY });
  const facts: [string, string][] = [
    ['Statement date', dayLabel(input.today)],
    ['Period', `${dayLabel(input.goal.startDate)} - ${dayLabel(input.today)}`],
    ['Entries', String(input.rows.length)],
  ];
  facts.forEach(([label, value], index) => {
    page.text(right - 150, y + 14 + index * 15, label, { size: 9, color: MUTED, align: 'right' });
    page.text(right, y + 14 + index * 15, value, { font: 'bold', size: 9, color: INK, align: 'right' });
  });
  y += 62;
  page.line(MARGIN, y, right, y, { width: 1.5, color: INK });
  y += 16;

  // The goal's facts, then the four totals.
  const cell = width / 4;
  const info: [string, string][] = [
    ['Goal', shown(input.goal.name)],
    ['Target', takaLabel(input.goal.targetAmount)],
    ['End date', dayLabel(input.goal.targetDate)],
    ['Status', STATUS[input.goal.status] ?? input.goal.status],
  ];
  info.forEach(([label, value], index) => {
    const x = MARGIN + index * cell;
    page.text(x + 10, y + 12, label, { size: 8.5, color: MUTED });
    page.text(x + 10, y + 27, fit(value, 11, cell - 20, 'bold'), { font: 'bold', size: 11, color: INK });
    if (index > 0) page.line(x, y, x, y + 36, { width: 0.75, color: HAIRLINE });
  });
  page.line(MARGIN, y + 40, right, y + 40, { width: 0.75, color: HAIRLINE });
  y += 52;
  const totals: [string, string, PdfColor][] = [
    ['Opening balance', takaLabel(input.totals.opening), INK],
    ['Money in', takaLabel(input.totals.moneyIn), IN],
    ['Money out', takaLabel(input.totals.moneyOut), OUT],
    ['Current balance', takaLabel(input.totals.balance), BRAND],
  ];
  totals.forEach(([label, value, tone], index) => {
    const x = MARGIN + index * cell;
    page.rect(x + (index ? 4 : 0), y, cell - 4, 40, SOFT);
    page.text(x + 12, y + 14, label, { size: 8.5, color: BODY });
    page.text(x + 12, y + 31, value, { font: 'bold', size: 13, color: tone });
  });
  y += 56;

  // The movements.
  const cols = { n: MARGIN + 4, date: MARGIN + 26, details: MARGIN + 96, from: MARGIN + 330, to: MARGIN + 450, inR: right - 170, outR: right - 90, balR: right - 4 };
  const head = () => {
    page.text(MARGIN, y, 'Transactions', { font: 'bold', size: 11, color: INK });
    y += 14;
    const labels: [number, string, 'left' | 'right'][] = [
      [cols.n, '#', 'left'],
      [cols.date, 'Date', 'left'],
      [cols.details, 'Details', 'left'],
      [cols.from, 'From', 'left'],
      [cols.to, 'To', 'left'],
      [cols.inR, 'In', 'right'],
      [cols.outR, 'Out', 'right'],
      [cols.balR, 'Balance', 'right'],
    ];
    labels.forEach(([x, text, align]) => page.text(x, y, text, { font: 'bold', size: 8.5, color: BODY, align }));
    y += 6;
    page.line(MARGIN, y, right, y, { width: 1.2, color: INK });
    y += 14;
  };
  const room = (needed: number) => {
    if (y + needed <= page.height - BOTTOM) return;
    page = doc.addPage(841.89, 595.28);
    y = MARGIN;
    head();
  };
  head();
  page.text(cols.date, y, dayLabel(input.goal.startDate), { size: 9, color: BODY });
  page.text(cols.details, y, 'Goal started', { size: 9, color: BODY });
  page.text(cols.balR, y, takaLabel(0), { font: 'bold', size: 9, color: INK, align: 'right' });
  y += 6;
  page.line(MARGIN, y, right, y, { width: 0.5, color: HAIRLINE });
  y += 14;
  input.rows.forEach((row, index) => {
    room(20);
    const text = statementRowText(row, input.goal.name);
    page.text(cols.n, y, String(index + 1), { size: 9, color: MUTED });
    page.text(cols.date, y, dayLabel(row.date), { size: 9, color: INK });
    page.text(cols.details, y, fit(text.details, 9, cols.from - cols.details - 10), { size: 9, color: INK });
    page.text(cols.from, y, fit(text.from, 9, cols.to - cols.from - 10), { size: 9, color: INK });
    page.text(cols.to, y, fit(text.to, 9, cols.inR - 80 - cols.to), { size: 9, color: INK });
    if (row.moneyIn) page.text(cols.inR, y, takaLabel(row.moneyIn), { font: 'bold', size: 9, color: IN, align: 'right' });
    if (row.moneyOut) page.text(cols.outR, y, takaLabel(row.moneyOut), { font: 'bold', size: 9, color: OUT, align: 'right' });
    page.text(cols.balR, y, takaLabel(row.balance), { font: 'bold', size: 9, color: INK, align: 'right' });
    y += 6;
    page.line(MARGIN, y, right, y, { width: 0.5, color: HAIRLINE });
    y += 14;
  });
  if (input.rows.length === 0) {
    page.text(cols.details, y, 'No money has moved for this goal yet.', { size: 9, color: MUTED });
    y += 18;
  }
  room(24);
  page.line(MARGIN, y - 10, right, y - 10, { width: 1.2, color: INK });
  page.text(cols.n, y + 4, 'Total', { font: 'bold', size: 9.5, color: INK });
  page.text(cols.inR, y + 4, takaLabel(input.totals.moneyIn), { font: 'bold', size: 9.5, color: IN, align: 'right' });
  page.text(cols.outR, y + 4, takaLabel(input.totals.moneyOut), { font: 'bold', size: 9.5, color: OUT, align: 'right' });
  page.text(cols.balR, y + 4, takaLabel(input.totals.balance), { font: 'bold', size: 9.5, color: INK, align: 'right' });
  y += 28;

  // Where it came from and where it is now, side by side.
  const lines = Math.max(input.sources.length, input.now.length, 1);
  if (y + 40 + lines * 15 > page.height - BOTTOM) {
    page = doc.addPage(841.89, 595.28);
    y = MARGIN;
  }
  const half = (width - 16) / 2;
  const box = (x: number, title: string, items: [string, string][], totalLabel: string, total: string, empty: string) => {
    let at = y;
    page.text(x, at, title, { font: 'bold', size: 10, color: INK });
    at += 16;
    if (items.length === 0) {
      page.text(x, at, empty, { size: 9, color: MUTED });
      at += 15;
    }
    for (const [label, value] of items) {
      page.text(x, at, fit(label, 9, half - 110), { size: 9, color: BODY });
      page.text(x + half, at, value, { font: 'bold', size: 9, color: INK, align: 'right' });
      at += 15;
    }
    page.line(x, at - 9, x + half, at - 9, { width: 0.5, color: HAIRLINE });
    page.text(x, at + 4, totalLabel, { font: 'bold', size: 9, color: INK });
    page.text(x + half, at + 4, total, { font: 'bold', size: 9, color: INK, align: 'right' });
    return at + 4;
  };
  const sourceLabel = (source: StatementPdfInput['sources'][number]) =>
    source.kind === 'ALREADY_SAVED' ? 'Already saved' : source.kind === 'GOAL' ? `Moved in from ${shown(source.name)}` : shown(source.name);
  const end = Math.max(
    box(MARGIN, 'Money came from', input.sources.map((source) => [sourceLabel(source), takaLabel(source.amount)]), 'Total in', takaLabel(input.totals.moneyIn), 'Nothing came in yet.'),
    box(MARGIN + half + 16, 'Where it is now', input.now.map((item) => [shown(item.name, 'Savings wallet'), takaLabel(item.amount)]), 'Current balance', takaLabel(input.totals.balance), 'Nothing is left in savings accounts.'),
  );
  y = end + 24;

  const footer = wrapText(
    `Generated by ${shown(input.platformName, 'Smartly')} on ${dayLabel(input.today)}. Goal transfers move money between goals only; the savings account balance stays the same. Withdrawals go to a main balance account.`,
    'regular',
    8.5,
    width,
  );
  if (y + footer.length * 11 > page.height - BOTTOM + 20) {
    page = doc.addPage(841.89, 595.28);
    y = MARGIN;
  }
  page.line(MARGIN, y - 10, right, y - 10, { width: 0.5, color: HAIRLINE });
  footer.forEach((text, index) => page.text(MARGIN, y + 2 + index * 11, text, { size: 8.5, color: MUTED }));

  return doc.toBuffer({ title: `Savings statement - ${shown(input.goal.name)}`, producer: shown(input.platformName, 'Smartly') });
}

// The download's file name: Smartly_<goal>_statement_<day>.pdf, kept to
// safe characters.
export function statementFileName(goalName: string, today: string): string {
  const name = goalName.replace(/\s+/g, '-').replace(/[^A-Za-z0-9_-]/g, '') || 'goal';
  return `Smartly_${name}_statement_${today}.pdf`;
}
