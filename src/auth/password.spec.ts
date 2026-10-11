import { hashPassword, verifyPassword } from './password.js';

describe('password', () => {
  it('round-trips through a bcrypt hash', async () => {
    const hash = await hashPassword('ChangeMe123!');
    expect(hash).toMatch(/^\$2[aby]\$10\$/);
    await expect(verifyPassword('ChangeMe123!', hash)).resolves.toBe(true);
  });

  it('rejects a different password', async () => {
    const hash = await hashPassword('ChangeMe123!');
    await expect(verifyPassword('changeme123!', hash)).resolves.toBe(false);
  });
});
