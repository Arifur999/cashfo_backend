import { HttpException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { totpAt } from '../two-step/totp.js';
import { AdminInvitesService } from './admin-invites.service.js';
import { AdminPasswordResetService } from './admin-password-reset.service.js';
import { ADMIN_RESET_TTL_MS, adminResetUsable, INVITE_TTL_MS, inviteState, resendWaitSec } from './invite-rules.js';

const sha = (raw: string) => createHash('sha256').update(raw).digest('hex');
const NOW = new Date('2026-10-27T10:00:00Z');

const reasonOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) {
      const body = error.getResponse();
      return { status: error.getStatus(), ...(typeof body === 'object' ? (body as object) : { message: body }) } as {
        status: number;
        reason?: string;
        message?: string;
      };
    }
    throw error;
  }
  return { status: 0 };
};

describe('invite rules', () => {
  it('lasts seven days, works once and can be revoked', () => {
    const invite = { expiresAt: new Date(NOW.getTime() + INVITE_TTL_MS), acceptedAt: null, revokedAt: null };
    expect(INVITE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(inviteState(invite, NOW)).toBe('PENDING');
    expect(inviteState(invite, new Date(NOW.getTime() + INVITE_TTL_MS))).toBe('EXPIRED');
    expect(inviteState({ ...invite, acceptedAt: NOW }, NOW)).toBe('ACCEPTED');
    expect(inviteState({ ...invite, revokedAt: NOW }, NOW)).toBe('REVOKED');
  });

  it('can be sent again after a minute', () => {
    expect(resendWaitSec(NOW, new Date(NOW.getTime() + 15_000))).toBe(45);
    expect(resendWaitSec(NOW, new Date(NOW.getTime() + 60_000))).toBe(0);
  });

  it('takes an admin reset link for 30 minutes, once, and only for an active admin', () => {
    const token = { usedAt: null, expiresAt: new Date(NOW.getTime() + ADMIN_RESET_TTL_MS) };
    const admin = { status: 'ACTIVE', isAdmin: true };
    expect(ADMIN_RESET_TTL_MS).toBe(30 * 60 * 1000);
    expect(adminResetUsable(token, admin, NOW)).toBe(true);
    expect(adminResetUsable(token, admin, new Date(NOW.getTime() + ADMIN_RESET_TTL_MS))).toBe(false);
    expect(adminResetUsable({ ...token, usedAt: NOW }, admin, NOW)).toBe(false);
    expect(adminResetUsable(token, { status: 'ACTIVE', isAdmin: false }, NOW)).toBe(false);
    expect(adminResetUsable(token, { status: 'SUSPENDED', isAdmin: true }, NOW)).toBe(false);
    expect(adminResetUsable(null, admin, NOW)).toBe(false);
  });
});

const SECRET = 'JBSWY3DPEHPK3PXP';

const invitesSetup = (invite: Record<string, unknown> | null, { canDeliver = true, emailTaken = false, claimWins = true } = {}) => {
  const tx = {
    adminInvite: { updateMany: vi.fn().mockResolvedValue({ count: claimWins ? 1 : 0 }), update: vi.fn(), create: vi.fn() },
    user: { create: vi.fn().mockResolvedValue({ id: 'new-admin', name: 'Rumana', email: 'rumana@example.com', role: 'FINANCE_ADMIN' }) },
    twoFactor: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  const prisma = {
    adminInvite: {
      findUnique: vi.fn().mockResolvedValue(invite),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn(),
    },
    user: { findUnique: vi.fn().mockResolvedValue(emailTaken ? { id: 'someone' } : null) },
    $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const mail = { canDeliver, sendAdminInviteEmail: vi.fn() };
  const credentials = { set: vi.fn() };
  const sessions = { create: vi.fn().mockResolvedValue('session-1') };
  const twoStep = {
    open: vi.fn(() => SECRET),
    seal: vi.fn(() => 'sealed'),
    newSecret: vi.fn(() => SECRET),
    otpauthUrl: vi.fn().mockResolvedValue('otpauth://totp/x'),
    replaceBackupCodes: vi.fn().mockResolvedValue(['aaaa-bbbb']),
  };
  const adminAuth = { finishSignIn: vi.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r', adminUser: { id: 'new-admin' } }) };
  const service = new AdminInvitesService(
    prisma as never,
    { get: () => 'https://smartly.example' } as never,
    mail as never,
    credentials as never,
    sessions as never,
    twoStep as never,
    adminAuth as never,
  );
  return { service, prisma, tx, mail, credentials, sessions, adminAuth };
};

const openInvite = (overrides: Record<string, unknown> = {}) => ({
  id: 'inv-1',
  email: 'rumana@example.com',
  name: null,
  role: 'FINANCE_ADMIN',
  tokenHash: sha('raw-token'),
  invitedById: 'super-1',
  invitedBy: { name: 'Nadia Rahman' },
  expiresAt: new Date(Date.now() + INVITE_TTL_MS),
  pendingSecretCiphertext: 'sealed',
  acceptedAt: null,
  acceptedUserId: null,
  revokedAt: null,
  lastSentAt: new Date(Date.now() - 120_000),
  createdAt: new Date(),
  ...overrides,
});

const acceptDto = () => ({ token: 'raw-token', name: 'Rumana', password: 'Secret-123', code: totpAt(SECRET, Date.now()) });
const client = { ipAddress: '203.0.113.7', userAgent: 'UA' };

describe('AdminInvitesService', () => {
  it('says why a link no longer works', async () => {
    await expect(invitesSetup(null).service.check('raw-token')).resolves.toEqual({ valid: false, reason: 'NOT_FOUND' });
    await expect(invitesSetup(openInvite({ expiresAt: new Date(Date.now() - 1) })).service.check('raw-token')).resolves.toEqual({
      valid: false,
      reason: 'EXPIRED',
    });
    await expect(invitesSetup(openInvite({ acceptedAt: new Date() })).service.check('raw-token')).resolves.toEqual({ valid: false, reason: 'ACCEPTED' });
    await expect(invitesSetup(openInvite()).service.check('raw-token')).resolves.toMatchObject({
      valid: true,
      invitedByName: 'Nadia Rahman',
      role: 'FINANCE_ADMIN',
    });
  });

  it('looks the link up by its hash only', async () => {
    const { service, prisma } = invitesSetup(openInvite());
    await service.check('raw-token');
    expect(prisma.adminInvite.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { tokenHash: sha('raw-token') } }));
  });

  it('creates the admin with two-step on, uses the invite up and signs them in', async () => {
    const { service, tx, credentials, adminAuth } = invitesSetup(openInvite());
    const result = await service.accept(acceptDto(), client);
    expect(result).toMatchObject({ audience: 'admin', accessToken: 'a', backupCodes: ['aaaa-bbbb'] });
    expect(tx.user.create).toHaveBeenCalledWith({ data: expect.objectContaining({ email: 'rumana@example.com', role: 'FINANCE_ADMIN', emailVerified: true }) });
    expect(credentials.set).toHaveBeenCalledWith('new-admin', 'Secret-123', tx);
    expect(tx.twoFactor.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: 'new-admin', enabledAt: expect.any(Date) }) });
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ adminUserId: 'new-admin', action: 'ADMIN_INVITE_ACCEPTED' }) });
    expect(adminAuth.finishSignIn).toHaveBeenCalled();
  });

  it('works once: a second accept racing the first is refused', async () => {
    const { service, tx } = invitesSetup(openInvite(), { claimWins: false });
    await expect(reasonOf(service.accept(acceptDto(), client))).resolves.toMatchObject({ status: 400, reason: 'INVITE_ACCEPTED' });
    expect(tx.user.create).not.toHaveBeenCalled();
  });

  it('refuses an expired, used or revoked link', async () => {
    for (const [overrides, reason] of [
      [{ expiresAt: new Date(Date.now() - 1) }, 'INVITE_EXPIRED'],
      [{ acceptedAt: new Date() }, 'INVITE_ACCEPTED'],
      [{ revokedAt: new Date() }, 'INVITE_REVOKED'],
    ] as const) {
      const { service, tx } = invitesSetup(openInvite(overrides));
      await expect(reasonOf(service.accept(acceptDto(), client))).resolves.toMatchObject({ status: 400, reason });
      expect(tx.user.create).not.toHaveBeenCalled();
    }
  });

  it('needs the right code from the key the page showed', async () => {
    const { service } = invitesSetup(openInvite());
    await expect(reasonOf(service.accept({ ...acceptDto(), code: '000000' }, client))).resolves.toMatchObject({ reason: 'CODE_WRONG' });
    const notStarted = invitesSetup(openInvite({ pendingSecretCiphertext: null }));
    await expect(reasonOf(notStarted.service.accept(acceptDto(), client))).resolves.toMatchObject({ reason: 'TWO_STEP_NOT_STARTED' });
  });

  it('answers 503 EMAIL_NOT_CONFIGURED when invites cannot be emailed, and 409 for a taken email', async () => {
    await expect(
      reasonOf(invitesSetup(null, { canDeliver: false }).service.create({ email: 'x@example.com', role: 'SUPPORT_ADMIN' }, 'super-1')),
    ).resolves.toMatchObject({
      status: 503,
      reason: 'EMAIL_NOT_CONFIGURED',
    });
    await expect(
      reasonOf(invitesSetup(null, { emailTaken: true }).service.create({ email: 'x@example.com', role: 'SUPPORT_ADMIN' }, 'super-1')),
    ).resolves.toMatchObject({
      status: 409,
    });
  });

  it('waits a minute between sends of the same invite', async () => {
    const { service } = invitesSetup(null);
    const prisma = (service as unknown as { prisma: { adminInvite: { findUnique: ReturnType<typeof vi.fn> } } }).prisma;
    prisma.adminInvite.findUnique.mockResolvedValue(openInvite({ lastSentAt: new Date(Date.now() - 10_000) }));
    await expect(reasonOf(service.resend('inv-1', 'super-1'))).resolves.toMatchObject({ status: 429, reason: 'RESEND_TOO_SOON' });
  });
});

const resetSetup = ({ token = null as Record<string, unknown> | null, owner = null as Record<string, unknown> | null, claimWins = true } = {}) => {
  const tx = {
    passwordResetToken: { updateMany: vi.fn().mockResolvedValue({ count: claimWins ? 1 : 0 }) },
    user: { findUnique: vi.fn().mockResolvedValue(owner) },
    auditLog: { create: vi.fn() },
  };
  const prisma = {
    user: { findUnique: vi.fn().mockResolvedValue(owner) },
    passwordResetToken: { findUnique: vi.fn().mockResolvedValue(token), updateMany: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(async (arg: unknown) => (typeof arg === 'function' ? (arg as (client: typeof tx) => unknown)(tx) : arg)),
  };
  const mail = { canDeliver: true, sendAdminPasswordResetEmail: vi.fn() };
  const credentials = { set: vi.fn() };
  const sessions = { revokeAllForUser: vi.fn() };
  const service = new AdminPasswordResetService(
    prisma as never,
    { get: () => 'https://smartly.example' } as never,
    mail as never,
    credentials as never,
    sessions as never,
  );
  return { service, prisma, tx, mail, credentials, sessions };
};

const ADMIN = { id: 'admin-1', name: 'Imran', email: 'imran@example.com', role: 'SUPPORT_ADMIN', status: 'ACTIVE', preferredLanguage: 'BN' };

describe('AdminPasswordResetService', () => {
  it('emails a 30-minute link to an active admin, in their language', async () => {
    const { service, prisma, mail } = resetSetup({ owner: ADMIN });
    await expect(service.forgot('imran@example.com')).resolves.toEqual({ success: true });
    expect(prisma.passwordResetToken.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: 'admin-1' }) });
    const [to, locale, email] = mail.sendAdminPasswordResetEmail.mock.calls[0];
    expect([to, locale, email.minutes]).toEqual(['imran@example.com', 'bn', 30]);
    expect(email.link).toMatch(/^https:\/\/smartly\.example\/admin\/reset-password\?token=[0-9a-f]{64}$/);
  });

  it('answers the same for a customer or an unknown email, and sends nothing', async () => {
    for (const owner of [null, { ...ADMIN, role: 'USER' }, { ...ADMIN, status: 'SUSPENDED' }]) {
      const { service, prisma, mail } = resetSetup({ owner });
      await expect(service.forgot('someone@example.com')).resolves.toEqual({ success: true });
      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
      expect(mail.sendAdminPasswordResetEmail).not.toHaveBeenCalled();
    }
  });

  it('sets the password once, signs the admin out everywhere and hands out no tokens', async () => {
    const { service, credentials, sessions, tx } = resetSetup({ token: { id: 't1', userId: 'admin-1' }, owner: ADMIN });
    await expect(service.reset('raw', 'New-pass-1', '203.0.113.7')).resolves.toEqual({ success: true });
    expect(credentials.set).toHaveBeenCalledWith('admin-1', 'New-pass-1', tx);
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith('admin-1');
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'ADMIN_PASSWORD_RESET_BY_EMAIL' }) });
  });

  it('refuses a used or expired link, and a customer link', async () => {
    const used = resetSetup({ token: { id: 't1', userId: 'admin-1' }, owner: ADMIN, claimWins: false });
    await expect(used.service.reset('raw', 'New-pass-1')).rejects.toThrow('invalid or has expired');
    expect(used.credentials.set).not.toHaveBeenCalled();

    const customer = resetSetup({ token: { id: 't1', userId: 'user-1' }, owner: { ...ADMIN, role: 'USER' } });
    await expect(customer.service.reset('raw', 'New-pass-1')).rejects.toThrow('invalid or has expired');
    expect(customer.credentials.set).not.toHaveBeenCalled();

    const expired = resetSetup({ token: { usedAt: null, expiresAt: new Date(Date.now() - 1), userId: 'admin-1' }, owner: ADMIN });
    await expect(expired.service.check('raw')).resolves.toEqual({ valid: false });
  });
});
