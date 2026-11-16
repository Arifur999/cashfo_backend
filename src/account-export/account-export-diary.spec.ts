import { AccountExportService, PRIVATE_LEFT_OUT } from './account-export.service.js';

// The journal sheet of Download my data: a private entry's words come in only
// when the diary was opened with its PIN on this sign-in.
const entry = (isPrivate: boolean) => ({
  date: new Date('2026-11-01T00:00:00.000Z'),
  kind: 'DAILY',
  mood: 1,
  wentWell: 'secret went well',
  gratefulFor: 'secret grateful',
  tomorrow: 'secret tomorrow',
  body: 'secret body',
  category: null,
  tags: [],
  isPrivate,
});

const journalSheet = async (diaryOpen: boolean) => {
  const prisma = {
    note: { findMany: vi.fn().mockResolvedValue([]) },
    journalEntry: { findMany: vi.fn().mockResolvedValue([entry(true), entry(false)]) },
  };
  const service = new AccountExportService(prisma as never);
  const sheets = await (service as unknown as { writingSheets: (userId: string, open: boolean) => Promise<{ name: string; rows: unknown[][] }[]> }).writingSheets(
    'user-1',
    diaryOpen,
  );
  return sheets.find((sheet) => sheet.name === 'journal.csv')!.rows;
};

describe('AccountExportService journal sheet', () => {
  it('leaves every word of a private entry out without the diary open, and keeps the open ones', async () => {
    const [locked, open] = await journalSheet(false);
    expect(locked.join('|')).not.toContain('secret');
    expect(locked).toContain(PRIVATE_LEFT_OUT);
    expect(open).toContain('secret body');
  });

  it('writes a private entry in full with the diary open', async () => {
    const [opened] = await journalSheet(true);
    expect(opened).toContain('secret body');
    expect(opened).not.toContain(PRIVATE_LEFT_OUT);
  });
});
