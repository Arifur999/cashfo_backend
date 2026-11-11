// Cover colours a book can have. The frontend has the matching palette
// (components/modules/Customer/HabitTracker/Books/bookPalette.ts) -- keep the keys in sync.
export const BOOK_COLORS = ['walnut', 'oxblood', 'forest', 'navy', 'mustard', 'teal', 'plum', 'slate', 'terracotta', 'sage'] as const;

export type BookColor = (typeof BOOK_COLORS)[number];

// The shelves every reader has on My books (the LibraryBooks board), "other"
// last; the frontend names and colours them (libraryShelves.ts). A reader's
// own shelves (BookShelf) stand between these and "other".
export const BOOK_SHELVES = ['faith', 'self', 'money', 'novel', 'essay', 'history', 'other'] as const;

// The colours a word can be highlighted in, while reading a note.
export const MARK_COLORS = ['yellow', 'green', 'pink'] as const;
