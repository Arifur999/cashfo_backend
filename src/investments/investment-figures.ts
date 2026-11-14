import { Prisma } from '@prisma/client';

export type EntryKind = 'INVEST' | 'ADD' | 'PROFIT' | 'BACK' | 'LOSS';

export interface FigureEntry {
  type: EntryKind;
  amount: Prisma.Decimal | number | string;
  // 'YYYY-MM-DD'
  day: string;
}

export interface InvestmentFigures {
  // Money put in: the first amount and every top-up.
  put: Prisma.Decimal;
  back: Prisma.Decimal;
  loss: Prisma.Decimal;
  profit: Prisma.Decimal;
  // put - back - loss: what is still in the investment.
  capital: Prisma.Decimal;
}

const ZERO = new Prisma.Decimal(0);

// What an investment's entries add up to. Capital is never typed: it is what
// was put in less what came back and what was lost. `upTo` ('YYYY-MM-DD')
// counts only the entries dated on or before it.
export function figuresOf(entries: FigureEntry[], upTo?: string): InvestmentFigures {
  let put = ZERO;
  let back = ZERO;
  let loss = ZERO;
  let profit = ZERO;
  for (const entry of entries) {
    if (upTo && entry.day > upTo) continue;
    const amount = new Prisma.Decimal(entry.amount);
    if (entry.type === 'INVEST' || entry.type === 'ADD') put = put.plus(amount);
    else if (entry.type === 'BACK') back = back.plus(amount);
    else if (entry.type === 'LOSS') loss = loss.plus(amount);
    else profit = profit.plus(amount);
  }
  return { put, back, loss, profit, capital: put.minus(back).minus(loss) };
}

// Whether a set of entries leaves the investment with capital that never
// goes below zero on any day: taking back or losing more than was in it at
// the time is refused, wherever in the history the change lands.
export function capitalStaysPositive(entries: FigureEntry[]): boolean {
  const days = [...new Set(entries.map((entry) => entry.day))].sort();
  return days.every((day) => !figuresOf(entries, day).capital.isNegative());
}

// The day a @db.Date column holds, 'YYYY-MM-DD'.
export const dayOf = (date: Date): string => date.toISOString().slice(0, 10);

// A 'YYYY-MM-DD' day as the Date a @db.Date column stores.
export const dateOf = (day: string): Date => new Date(`${day.slice(0, 10)}T00:00:00.000Z`);
