import { isAPIError } from 'better-auth/api';
import { createAuth } from './better-auth.js';

// Settings "Allow new sign-ups": better-auth's user hook refuses every new
// account while it is off (email sign-up and a first Google sign-in alike).
describe('better-auth user.create hook', () => {
  const hookWith = (value: unknown) => {
    const prisma = { platformSetting: { findUnique: vi.fn().mockResolvedValue(value === undefined ? null : { value }) } };
    const auth = createAuth({ prisma: prisma as never, secret: 'x'.repeat(32), baseURL: 'http://localhost:5000', trustedOrigins: [] });
    const before = auth.options.databaseHooks?.user?.create?.before;
    if (!before) throw new Error('no user.create hook');
    // Called the way better-auth calls it: the new user, then the context.
    return (data: Record<string, unknown>) => (before as unknown as (user: unknown, context: unknown) => Promise<unknown>)(data, null);
  };

  it('lets a new account through while sign-ups are open (or never set)', async () => {
    await expect(hookWith(true)({ email: 'a@example.com' })).resolves.toBeUndefined();
    await expect(hookWith(undefined)({ email: 'a@example.com' })).resolves.toBeUndefined();
  });

  it('refuses one while they are closed, with a code the Google callback redirects with', async () => {
    const error = await hookWith(false)({ email: 'a@example.com' }).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(isAPIError(error)).toBe(true);
    expect((error as { statusCode: number; body: { code: string; message: string } }).statusCode).toBe(403);
    expect((error as { body: { code: string; message: string } }).body).toMatchObject({ code: 'signups_closed', message: 'New sign-ups are closed for now.' });
  });
});
