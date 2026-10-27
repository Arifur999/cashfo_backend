import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AccountDeletionService } from './account-deletion.service.js';
import { purgeUser } from './account-purge.js';
import { anonymisedUser, deletionDate, isPurgeDue, isRestorable } from './deletion-rules.js';

const NOW = new Date('2026-10-27T06:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

describe('deletion rules', () => {
  it('schedules the purge 30 days on', () => {
    expect(deletionDate(NOW)).toEqual(new Date('2026-11-26T06:00:00.000Z'));
  });

  it('restores inside the 30 days and purges after them', () => {
    const pending = { status: 'PENDING_DELETION' as const, deletionScheduledFor: new Date(NOW.getTime() + DAY) };
    expect(isRestorable(pending, NOW)).toBe(true);
    expect(isPurgeDue(pending, NOW)).toBe(false);
    const due = { ...pending, deletionScheduledFor: new Date(NOW.getTime() - 1) };
    expect(isRestorable(due, NOW)).toBe(false);
    expect(isPurgeDue(due, NOW)).toBe(true);
    // The very moment counts as due.
    expect(isPurgeDue({ ...pending, deletionScheduledFor: NOW }, NOW)).toBe(true);
  });

  it('never purges or restores an account that is not pending', () => {
    for (const status of ['ACTIVE', 'SUSPENDED', 'DELETED'] as const) {
      const user = { status, deletionScheduledFor: new Date(NOW.getTime() - DAY) };
      expect(isPurgeDue(user, NOW)).toBe(false);
      expect(isRestorable(user, NOW)).toBe(false);
    }
  });

  it('anonymises the row so nothing leads back to the person', () => {
    const row = anonymisedUser('u1');
    expect(row).toMatchObject({ name: 'Deleted user', email: 'deleted+u1@deleted.invalid', phone: null, avatarUrl: null, referralCode: null, status: 'DELETED' });
    expect(row.vaultPasswordHash).toBeNull();
  });
});

const user = (over: Record<string, unknown> = {}) => ({
  id: 'u1',
  name: 'Nusrat Jahan',
  email: 'nusrat@example.com',
  role: 'USER',
  status: 'ACTIVE',
  preferredLanguage: 'EN',
  deletionScheduledFor: null,
  ...over,
});

const setup = (found: ReturnType<typeof user> | null = user()) => {
  const tx = {
    user: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUnique: vi.fn().mockResolvedValue(found), update: vi.fn() },
    payment: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    payoutRequest: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    userSubscription: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    pushSubscription: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    $executeRaw: vi.fn().mockResolvedValue(1),
  };
  const prisma = {
    user: { findUnique: vi.fn().mockResolvedValue(found), updateMany: vi.fn().mockResolvedValue({ count: 1 }), findMany: vi.fn().mockResolvedValue([]) },
    userSession: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
    $transaction: vi.fn((run: (client: typeof tx) => Promise<unknown>) => run(tx)),
  };
  const sessions = { revokeAllForUser: vi.fn().mockResolvedValue(undefined) };
  const twoStep = { confirmSensitiveAction: vi.fn().mockResolvedValue(undefined) };
  const mail = { sendAccountDeletionEmail: vi.fn().mockResolvedValue(undefined) };
  const config = { get: vi.fn().mockReturnValue('https://app.example') };
  const service = new AccountDeletionService(prisma as never, sessions as never, twoStep as never, mail as never, config as never);
  return { service, prisma, tx, sessions, twoStep, mail };
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AccountDeletionService.request', () => {
  it('locks the account, stops money moving, signs out everywhere and emails the date', async () => {
    const { service, tx, prisma, sessions, twoStep, mail } = setup();

    await expect(service.request('u1', 's1', undefined, { confirm: 'DELETE', password: 'pw' })).resolves.toEqual({
      scheduledFor: new Date('2026-11-26T06:00:00.000Z'),
    });

    expect(twoStep.confirmSensitiveAction).toHaveBeenCalledWith('u1', { password: 'pw', sessionId: 's1' }, { code: undefined, backupCode: undefined });
    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u1', status: 'ACTIVE' },
      data: { status: 'PENDING_DELETION', deletionRequestedAt: NOW, deletionScheduledFor: new Date('2026-11-26T06:00:00.000Z') },
    });
    expect(tx.payment.updateMany).toHaveBeenCalledWith({ where: { userId: 'u1', status: 'PENDING' }, data: { status: 'FAILED', failureReason: 'account_deleted' } });
    expect(tx.payoutRequest.updateMany).toHaveBeenCalledWith({ where: { userId: 'u1', status: 'REQUESTED' }, data: { status: 'CANCELLED', cancelledAt: NOW } });
    expect(tx.userSubscription.updateMany).toHaveBeenCalledWith({ where: { userId: 'u1' }, data: { cancelAtPeriodEnd: true } });
    expect(tx.pushSubscription.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith('u1');
    expect(prisma.userSession.updateMany).toHaveBeenCalledWith({ where: { userId: 'u1', revokedAt: null }, data: { revokedAt: NOW } });
    expect(mail.sendAccountDeletionEmail).toHaveBeenCalledWith('nusrat@example.com', 'en', expect.objectContaining({ deletionDate: '26 Nov 2026' }));
  });

  it('still deletes when the email cannot be sent', async () => {
    const { service, mail } = setup();
    mail.sendAccountDeletionEmail.mockRejectedValue(new Error('no key'));
    await expect(service.request('u1', 's1', undefined, { confirm: 'DELETE', password: 'pw' })).resolves.toHaveProperty('scheduledFor');
  });

  it('refuses a support view, and an account that is not active', async () => {
    await expect(setup().service.request('u1', 's1', 'admin-1', { confirm: 'DELETE' })).rejects.toBeInstanceOf(ForbiddenException);
    const { service, tx } = setup(user({ status: 'SUSPENDED' }));
    await expect(service.request('u1', 's1', undefined, { confirm: 'DELETE', password: 'pw' })).rejects.toBeInstanceOf(ConflictException);
    expect(tx.user.updateMany).not.toHaveBeenCalled();
  });

  it('changes nothing when the password or code is wrong', async () => {
    const { service, twoStep, tx, sessions } = setup();
    twoStep.confirmSensitiveAction.mockRejectedValue(new Error('Your password is incorrect.'));
    await expect(service.request('u1', 's1', undefined, { confirm: 'DELETE', password: 'nope' })).rejects.toThrow('incorrect');
    expect(tx.user.updateMany).not.toHaveBeenCalled();
    expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
  });
});

describe('AccountDeletionService.restoreOnSignIn', () => {
  it('leaves an active account alone', async () => {
    const { service, prisma } = setup();
    await expect(service.restoreOnSignIn(user() as never)).resolves.toEqual({ restored: false });
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('brings back an account inside its 30 days', async () => {
    const { service, prisma } = setup();
    const pending = user({ status: 'PENDING_DELETION', deletionScheduledFor: new Date(NOW.getTime() + DAY) });
    await expect(service.restoreOnSignIn(pending as never)).resolves.toEqual({ restored: true });
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u1', status: 'PENDING_DELETION' },
      data: { status: 'ACTIVE', deletionRequestedAt: null, deletionScheduledFor: null },
    });
  });

  it('purges an account whose day has passed and refuses the sign-in', async () => {
    const due = user({ status: 'PENDING_DELETION', deletionScheduledFor: new Date(NOW.getTime() - DAY) });
    const { service, prisma } = setup(due);
    const purge = vi.spyOn(service, 'purge').mockResolvedValue(true);
    await expect(service.restoreOnSignIn(due as never)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(purge).toHaveBeenCalledWith('u1', NOW);
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });
});

describe('AccountDeletionService.purge', () => {
  it('purges only a pending account that is due, under its own lock', async () => {
    const due = user({ status: 'PENDING_DELETION', deletionScheduledFor: new Date(NOW.getTime() - DAY) });
    const { service, tx } = setup(due);
    const fullTx = {
      ...tx,
      business: { findMany: vi.fn().mockResolvedValue([]) },
    };
    // Every other table the purge touches answers deleteMany/updateMany.
    const anyTable = new Proxy(fullTx as Record<string, unknown>, {
      get: (target, key: string) => target[key] ?? { deleteMany: vi.fn().mockResolvedValue({ count: 0 }), updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    });
    (service as unknown as { prisma: { $transaction: unknown } }).prisma.$transaction = vi.fn((run: (client: unknown) => Promise<unknown>) => run(anyTable));

    await expect(service.purge('u1', NOW)).resolves.toBe(true);
    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: anonymisedUser('u1') });
  });

  it('does nothing for an account restored in the meantime', async () => {
    const { service, tx } = setup(user({ status: 'ACTIVE' }));
    await expect(service.purge('u1', NOW)).resolves.toBe(false);
    expect(tx.user.update).not.toHaveBeenCalled();
  });
});

describe('purgeUser', () => {
  it('deletes the owned workspaces and the personal data, then anonymises the row', async () => {
    const calls: string[] = [];
    const table = (name: string) => ({
      deleteMany: vi.fn(async () => {
        calls.push(`${name}.deleteMany`);
        return { count: 0 };
      }),
      updateMany: vi.fn(async () => {
        calls.push(`${name}.updateMany`);
        return { count: 0 };
      }),
      findMany: vi.fn(async () => (name === 'business' ? [{ id: 'b1' }, { id: 'b2' }] : [])),
      update: vi.fn(async () => {
        calls.push(`${name}.update`);
        return {};
      }),
    });
    const tx = new Proxy({} as Record<string, ReturnType<typeof table>>, { get: (target, key: string) => (target[key] ??= table(key)) });

    await purgeUser(tx as never, 'u1', 'nusrat@example.com');

    // Entries go before their transactions, transactions before contacts and
    // accounts, and the workspaces last of their data.
    const at = (call: string) => calls.indexOf(call);
    expect(at('transactionEntry.deleteMany')).toBeLessThan(at('transaction.deleteMany'));
    expect(at('transaction.deleteMany')).toBeLessThan(at('contact.deleteMany'));
    expect(at('account.updateMany')).toBeLessThan(at('account.deleteMany'));
    expect(at('groupExpenseSplit.deleteMany')).toBeLessThan(at('groupMember.deleteMany'));
    expect(at('businessMember.deleteMany')).toBeLessThan(at('business.deleteMany'));
    expect(tx.business.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['b1', 'b2'] } } });
    for (const personal of ['vaultEntry', 'habit', 'book', 'skill', 'todoList', 'pushSubscription', 'payoutMethod', 'trustedDevice', 'authSession', 'authAccount']) {
      expect(tx[personal].deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    }
    expect(tx.loginAttempt.deleteMany).toHaveBeenCalledWith({ where: { email: 'nusrat@example.com' } });
    // Payments, invoices, referrals and tickets are never deleted.
    for (const kept of ['payment', 'invoice', 'referral', 'supportTicket', 'payoutRequest']) {
      expect(calls.some((call) => call.startsWith(`${kept}.delete`))).toBe(false);
    }
    expect(calls[calls.length - 1]).toBe('user.update');
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: anonymisedUser('u1') });
  });
});
