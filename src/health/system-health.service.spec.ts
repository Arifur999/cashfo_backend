import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isWritable } from './system-health.service.js';

describe('isWritable', () => {
  it('writes a test file and leaves nothing behind', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'health-'));
    try {
      await expect(isWritable(dir)).resolves.toBe(true);
      await expect(readdir(dir)).resolves.toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('is false for a folder that is not there', async () => {
    await expect(isWritable(join(tmpdir(), 'no-such-folder-for-health', 'x'))).resolves.toBe(false);
  });
});
