import { CredentialsService } from './credentials.service.js';
import { hashPassword } from './password.js';

const fakeDb = (account: { password: string | null } | null = null) => ({
  authAccount: {
    findUnique: vi.fn().mockResolvedValue(account),
    upsert: vi.fn().mockResolvedValue({}),
  },
});

const serviceWith = (db: ReturnType<typeof fakeDb>) => new CredentialsService(db as never);

describe('CredentialsService', () => {
  it('matches only the stored password', async () => {
    const service = serviceWith(fakeDb({ password: await hashPassword('Secret-123') }));
    await expect(service.verify('user-1', 'Secret-123')).resolves.toBe(true);
    await expect(service.verify('user-1', 'Secret-124')).resolves.toBe(false);
  });

  it('never matches an account without a password', async () => {
    await expect(serviceWith(fakeDb(null)).verify('user-1', 'Secret-123')).resolves.toBe(false);
    await expect(serviceWith(fakeDb({ password: null })).verify('user-1', 'Secret-123')).resolves.toBe(false);
  });

  it('stores a fresh bcrypt hash on the credential account', async () => {
    const db = fakeDb();
    await serviceWith(db).set('user-1', 'Secret-123');

    const [args] = db.authAccount.upsert.mock.calls[0];
    expect(args.where).toEqual({ providerId_accountId: { providerId: 'credential', accountId: 'user-1' } });
    expect(args.create).toMatchObject({ userId: 'user-1', providerId: 'credential', accountId: 'user-1' });
    expect(args.update.password).toMatch(/^\$2[aby]\$10\$/);
    expect(args.update.password).not.toBe('Secret-123');
  });

  it('writes through the transaction client it is given', async () => {
    const db = fakeDb();
    const tx = fakeDb();
    await serviceWith(db).set('user-1', 'Secret-123', tx as never);

    expect(tx.authAccount.upsert).toHaveBeenCalledOnce();
    expect(db.authAccount.upsert).not.toHaveBeenCalled();
  });
});
