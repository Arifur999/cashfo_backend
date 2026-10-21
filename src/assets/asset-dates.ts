// The dates an asset's valuations and sale may carry. Pure, so the rules are
// tested on their own; dates compare as calendar days (a valuation's date is
// a day, older history rows carry the time they were made).

const dayOf = (date: Date | string): string => new Date(date).toISOString().slice(0, 10);

// Nothing happens to an asset before it was bought.
export const isBeforePurchase = (date: string, purchaseDate: Date): boolean => dayOf(date) < dayOf(purchaseDate);

// Whether a valuation dated `date` is the asset's newest, the one shown as
// its value today. An older date only fills in the history.
export const isNewestValuation = (date: string, newestRecordedAt: Date | null): boolean => newestRecordedAt === null || dayOf(date) >= dayOf(newestRecordedAt);
