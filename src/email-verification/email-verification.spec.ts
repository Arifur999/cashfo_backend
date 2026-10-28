import { hashVerifyToken, verifyLinkUsable } from './email-verification-rules.js';
import { EmailVerificationService } from './email-verification.service.js';

const now = new Date('2026-10-28T09:00:00Z');
const row = { email: 'nadia@example.com', expiresAt: new Date('2026-10-29T09:00:00Z'), usedAt: null };
const owner = { email: 'nadia@example.com', status: 'ACTIVE' };

describe('verifyLinkUsable', () => {
  it('accepts an unused, unexpired link for the current address', () => {
    expect(verifyLinkUsable(row, owner, now)).toBe(true);
  });

  it('refuses a used, expired or missing link', () => {
    expect(verifyLinkUsable({ ...row, usedAt: now }, owner, now)).toBe(false);
    expect(verifyLinkUsable({ ...row, expiresAt: now }, owner, now)).toBe(false);
    expect(verifyLinkUsable(null, owner, now)).toBe(false);
  });

  it('refuses a link for an address the account no longer has, or a deleted account', () => {
    expect(verifyLinkUsable(row, { ...owner, email: 'new@example.com' }, now)).toBe(false);
    expect(verifyLinkUsable(row, { ...owner, status: 'DELETED' }, now)).toBe(false);
    expect(verifyLinkUsable(row, null, now)).toBe(false);
  });
});

const reasonOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return (error as { response?: { reason?: string } }).response?.reason;
  }
  return undefined;
};

const setup = ({ verified = false, canDeliver = true, tokenRow = null as Record<string, unknown> | null, claim = 1, sendFails = false } = {}) => {
  const user = {
    id: 'u1',
    name: 'Nadia',
    email: 'nadia@example.com',
    preferredLanguage: 'BN',
    emailVerified: verified,
    status: 'ACTIVE',
    emailVerifiedAt: null,
  };
  const tx = {
    emailVerificationToken: { updateMany: vi.fn().mockResolvedValue({ count: claim }) },
    user: { findUnique: vi.fn().mockResolvedValue(user), update: vi.fn() },
  };
  const prisma = {
    user: { findUniqueOrThrow: vi.fn().mockResolvedValue(user), findUnique: vi.fn().mockResolvedValue(user) },
    emailVerificationToken: {
      findUnique: vi.fn().mockResolvedValue(tokenRow),
      updateMany: vi.fn(),
      create: vi.fn().mockResolvedValue({ id: 't1' }),
      delete: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn((arg: unknown) => (typeof arg === 'function' ? (arg as (t: typeof tx) => unknown)(tx) : Promise.all(arg as unknown[]))),
  };
  const mail = { canDeliver, sendVerifyEmail: sendFails ? vi.fn().mockRejectedValue(new Error('down')) : vi.fn() };
  const config = { get: vi.fn(() => 'https://app.example') };
  const service = new EmailVerificationService(prisma as never, config as never, mail as never);
  return { service, prisma, tx, mail };
};

describe('EmailVerificationService', () => {
  it('mails a link for the current address and answers with the masked address', async () => {
    const { service, prisma, mail } = setup();
    const result = await service.send('u1');
    expect(result).toMatchObject({ sent: true, sentTo: 'n***@example.com' });
    expect(prisma.emailVerificationToken.updateMany).toHaveBeenCalledWith({ where: { userId: 'u1', usedAt: null }, data: { usedAt: expect.any(Date) } });
    expect(mail.sendVerifyEmail).toHaveBeenCalledWith('nadia@example.com', 'bn', expect.objectContaining({ hours: 24 }));
    const link: string = mail.sendVerifyEmail.mock.calls[0][2].link;
    const token = new URL(link).searchParams.get('token')!;
    expect(link.startsWith('https://app.example/verify-email?token=')).toBe(true);
    expect(prisma.emailVerificationToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tokenHash: hashVerifyToken(token), email: 'nadia@example.com' }),
    });
  });

  it('says so when the address is already verified, and refuses without email', async () => {
    expect(await setup({ verified: true }).service.send('u1')).toEqual({ alreadyVerified: true });
    expect(await reasonOf(setup({ canDeliver: false }).service.send('u1'))).toBe('EMAIL_NOT_CONFIGURED');
  });

  it('drops the link and answers EMAIL_NOT_SENT when the send fails', async () => {
    const { service, prisma } = setup({ sendFails: true });
    expect(await reasonOf(service.send('u1'))).toBe('EMAIL_NOT_SENT');
    expect(prisma.emailVerificationToken.delete).toHaveBeenCalledWith({ where: { id: 't1' } });
  });

  it('verifies with a good link, once', async () => {
    const tokenRow = { id: 't1', userId: 'u1', ...row };
    const good = setup({ tokenRow });
    expect(await good.service.verify('raw')).toEqual({ verified: true, email: 'nadia@example.com' });
    expect(good.tx.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { emailVerified: true, emailVerifiedAt: expect.any(Date) } });

    const raced = setup({ tokenRow, claim: 0 });
    expect(await reasonOf(raced.service.verify('raw'))).toBe('LINK_INVALID');
    expect(await reasonOf(setup().service.verify('raw'))).toBe('LINK_INVALID');
  });

  it('checks a link without using it', async () => {
    expect(await setup({ tokenRow: { id: 't1', userId: 'u1', ...row, expiresAt: new Date(Date.now() + 1000) } }).service.check('raw')).toEqual({
      valid: true,
      email: 'nadia@example.com',
    });
    expect(await setup().service.check('raw')).toEqual({ valid: false });
  });
});
