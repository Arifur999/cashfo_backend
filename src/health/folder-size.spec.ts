import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { folderSize } from './system-health.service.js';

describe('folderSize', () => {
  it('adds up the files in a folder and its subfolders', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'size-'));
    try {
      await writeFile(join(dir, 'a.png'), Buffer.alloc(1000));
      await mkdir(join(dir, 'receipts'));
      await writeFile(join(dir, 'receipts', 'b.pdf'), Buffer.alloc(2500));
      await expect(folderSize(dir)).resolves.toBe(3500);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
