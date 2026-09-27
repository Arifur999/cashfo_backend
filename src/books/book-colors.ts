// Cover colours a book can have. The user-frontend has the matching palette
// (components/habit-tracker/books/bookPalette.ts) -- keep the keys in sync.
export const BOOK_COLORS = ['walnut', 'oxblood', 'forest', 'navy', 'mustard', 'teal', 'plum', 'slate', 'terracotta', 'sage'] as const;

export type BookColor = (typeof BOOK_COLORS)[number];
