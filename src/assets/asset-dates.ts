// The dates an asset's valuations and sale may carry. Pure, so the rules are
// tested on their own; dates compare as calendar days (a valuation's date is
// a day, older history rows carry the time they were made).

const dayOf = (date: Date | string): string => new Date(date).toISOString().slice(0, 10);

// Nothing happens to an asset before it was bought.
export const isBeforePurchase = (date: string, purchaseDate: Date): boolean => dayOf(date) < dayOf(purchaseDate);

// Whether a valuation dated `date` is the asset's newest, the one shown as
// its value today. An older date only fills in the history.
export const isNewestValuation = (date: string, newestRecordedAt: Date | null): boolean => newestRecordedAt === null || dayOf(date) >= dayOf(newestRecordedAt);

// The notes the purchase writes on an asset's first history row.
const INITIAL_NOTES = new Set(['Initial value', 'Initial purchase value']);
const isInitialNote = (note: string | null): boolean => note !== null && INITIAL_NOTES.has(note);

export interface HistoryRow {
  id: string;
  recordedAt: Date;
  note: string | null;
}

// The history row the purchase itself wrote: the oldest, since nothing is
// valued before the asset was bought. A value check on the purchase day
// shares its day, so there the row with the purchase's note wins.
export const purchaseRowOf = <T extends HistoryRow>(rows: T[]): T | undefined =>
  rows.reduce<T | undefined>((first, row) => {
    if (first === undefined) return row;
    const day = dayOf(row.recordedAt);
    const firstDay = dayOf(first.recordedAt);
    if (day !== firstDay) return day < firstDay ? row : first;
    return isInitialNote(row.note) && !isInitialNote(first.note) ? row : first;
  }, undefined);

// Whether the purchase may move to `date`: every value recorded besides the
// purchase's own row is on that day or later.
export const canMovePurchaseTo = (date: Date | string, rows: HistoryRow[], purchaseRowId: string | undefined): boolean =>
  rows.every((row) => row.id === purchaseRowId || dayOf(row.recordedAt) >= dayOf(date));
