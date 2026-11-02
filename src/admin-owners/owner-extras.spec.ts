import { ConflictException, ForbiddenException } from '@nestjs/common';
import { AdminNotesService } from './admin-notes.service.js';
import { AdminOwnersService } from './admin-owners.service.js';
import { ownerExtras, workspacesIncluded } from './owner-detail.js';
import { ownersCsv } from './owners-export.js';

const NOW = new Date('2026-10-02T06:00:00.000Z');

describe('workspacesIncluded', () => {
  const ws = (id: string, isDefault: boolean, created: string) => ({ id, name: id, type: 'BUSINESS', isDefault, createdAt: new Date(created) });

  it('counts the default workspace first, then the oldest, up to the plan', () => {
    const rows = workspacesIncluded([ws('shop', false, '2026-04-14'), ws('own', true, '2026-01-03'), ws('side', false, '2026-02-01')], 2);
    expect(rows.map((row) => [row.id, row.includedInPlan])).toEqual([
      ['own', true],
      ['side', true],
      ['shop', false],
    ]);
  });

  it('includes every workspace when the plan has no limit', () => {
    expect(workspacesIncluded([ws('a', true, '2026-01-01'), ws('b', false, '2026-01-02')], -1).every((row) => row.includedInPlan)).toBe(true);
  });
});


describe('ownerExtras', () => {
  it('adds up wallets, transactions, referrals, payments, devices and tickets', async () => {
    const prisma = {
      account: {
        groupBy: vi.fn().mockResolvedValue([
          { accountSubtype: 'cash', _count: 1 },
          { accountSubtype: 'bank', _count: 2 },
          { accountSubtype: 'mfs', _count: 2 },
        ]),
      },
      transaction: { count: vi.fn().mockResolvedValue(146), groupBy: vi.fn().mockResolvedValue([{ businessId: 'own', _count: 112 }, { businessId: 'shop', _count: 34 }]) },
      referral: {
        findMany: vi.fn().mockResolvedValue([{ _count: { commissions: 1 } }, { _count: { commissions: 2 } }, { _count: { commissions: 0 } }]),
      },
      referralCommission: {
        groupBy: vi.fn().mockResolvedValue([
          { status: 'AVAILABLE', _sum: { amount: 54 } },
          { status: 'PAID_OUT', _sum: { amount: 54 } },
          { status: 'REVERSED', _sum: { amount: 30 } },
        ]),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      payoutRequest: { findMany: vi.fn().mockResolvedValue([]) },
      payment: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 2033 }, _count: 7 }),
        findFirst: vi.fn().mockResolvedValue({ couponId: 'c1', createdAt: new Date('2026-03-12') }),
      },
      coupon: { findUnique: vi.fn().mockResolvedValue({ code: 'WELCOME20' }) },
      supportTicket: {
        findMany: vi.fn().mockResolvedValue([{ id: 't1', subject: "Can't export", status: 'OPEN' }]),
        groupBy: vi.fn().mockResolvedValue([
          { status: 'OPEN', _count: 1 },
          { status: 'RESOLVED', _count: 2 },
          { status: 'CLOSED', _count: 1 },
        ]),
      },
      userSession: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'd1', jti: 's1', deviceLabel: 'Chrome on Windows', ipAddress: '203.0.113.12', createdAt: NOW, lastUsedAt: NOW, revokedAt: null },
          { id: 'd2', jti: 's2', deviceLabel: 'Chrome on Android', ipAddress: '198.51.100.7', createdAt: NOW, lastUsedAt: NOW, revokedAt: NOW },
        ]),
      },
      authSession: { findMany: vi.fn().mockResolvedValue([{ id: 's1', impersonatedBy: null }]) },
      adminNote: { count: vi.fn().mockResolvedValue(1) },
    };
    const owner = {
      id: 'u1',
      ownedBusinesses: [
        { id: 'own', name: "Sharmin's Personal", type: 'PERSONAL', isDefault: true, createdAt: new Date('2026-01-03') },
        { id: 'shop', name: 'Akter Fashion House', type: 'BUSINESS', isDefault: false, createdAt: new Date('2026-04-14') },
      ],
    };
    const subscription = {
      status: 'ACTIVE',
      trialEndsAt: null,
      currentPeriodEnd: new Date('2026-10-12'),
      cancelAtPeriodEnd: false,
      lockedPrice: null,
      plan: { name: 'Monthly Pro', billingCycle: 'MONTHLY' as const, price: 299, featureLimits: { maxWorkspaces: 1 } },
    };

    const extras = await ownerExtras(prisma as never, owner, subscription, NOW);

    expect(extras.stats).toMatchObject({
      workspaces: 2,
      workspaceLimit: 1,
      wallets: 5,
      transactionsLast30d: 146,
      referralFriends: 3,
      referralBought: 2,
      referralEarned: '108.00',
    });
    expect(extras.workspaces).toEqual([
      expect.objectContaining({ id: 'own', transactionCount: 112, includedInPlan: true }),
      expect.objectContaining({ id: 'shop', transactionCount: 34, includedInPlan: false }),
    ]);
    expect(extras.devices.map((device) => [device.id, device.signedIn])).toEqual([
      ['d1', true],
      ['d2', false],
    ]);
    expect(extras.signedInDevices).toBe(1);
    expect(extras.billing).toMatchObject({ planName: 'Monthly Pro', price: '299.00', renewsOn: new Date('2026-10-12'), paidSoFar: '2033.00', paymentCount: 7 });
    expect(extras.billing?.firstCoupon).toMatchObject({ code: 'WELCOME20' });
    expect(extras.support).toMatchObject({ open: 1, closed: 3 });
    expect(extras.tabCounts).toEqual({ billing: 7, support: 4, notes: 1 });
    // Only posted, unreversed transactions count, as every total does.
    expect(prisma.transaction.count.mock.calls[0][0].where).toMatchObject({ status: 'POSTED', reversalOfId: null });
  });

  it('leaves out a support view of the account from its devices', async () => {
    const prisma = {
      account: { groupBy: vi.fn().mockResolvedValue([]) },
      transaction: { count: vi.fn().mockResolvedValue(0), groupBy: vi.fn().mockResolvedValue([]) },
      referral: { findMany: vi.fn().mockResolvedValue([]) },
      referralCommission: { groupBy: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null) },
      payoutRequest: { findMany: vi.fn().mockResolvedValue([]) },
      payment: { aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null }, _count: 0 }), findFirst: vi.fn().mockResolvedValue(null) },
      supportTicket: { findMany: vi.fn().mockResolvedValue([]), groupBy: vi.fn().mockResolvedValue([]) },
      userSession: { findMany: vi.fn().mockResolvedValue([{ id: 'd1', jti: 'view', deviceLabel: 'x', ipAddress: '1.1.1.1', createdAt: NOW, lastUsedAt: NOW, revokedAt: null }]) },
      authSession: { findMany: vi.fn().mockResolvedValue([{ id: 'view', impersonatedBy: 'admin-1' }]) },
      adminNote: { count: vi.fn().mockResolvedValue(0) },
    };
    const extras = await ownerExtras(prisma as never, { id: 'u1', ownedBusinesses: [] }, null, NOW);
    expect(extras.devices).toEqual([]);
    expect(extras.billing).toBeNull();
  });
});

describe('ownersCsv', () => {
  it('writes the list columns with Dhaka dates', () => {
    const { fileName, data } = ownersCsv(
      [
        {
          name: 'Liton Das',
          email: 'liton@example.com',
          phone: null,
          businessName: null,
          workspaceCount: 0,
          planName: null,
          status: 'PENDING_DELETION',
          lastLoginAt: new Date('2026-06-01T20:00:00.000Z'),
          daysUsing: 300,
          deletionScheduledFor: new Date('2026-10-30T19:00:00.000Z'),
        },
      ],
      NOW,
    );
    expect(fileName).toBe('users-2026-10-02.csv');
    const lines = data.toString('utf8').replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe('Name,Email,Phone,Workspace,Workspaces,Plan,Status,Last active (Dhaka),Using for (days),Deleted on');
    expect(lines[1]).toBe('Liton Das,liton@example.com,,,0,,Being deleted,2026-06-02,300,2026-10-31');
  });
});

describe('AdminOwnersService admin actions', () => {
  const setup = (owner: Record<string, unknown>) => {
    const prisma = {
      user: { findUnique: vi.fn().mockResolvedValue({ id: 'u1', ...owner }), update: vi.fn().mockResolvedValue({ id: 'u1', status: 'SUSPENDED' }) },
      userSession: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
      authSession: { count: vi.fn().mockResolvedValue(2) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn((run: (tx: unknown) => Promise<unknown>) => run(prisma)),
    };
    const sessions = { revokeAllForUser: vi.fn().mockResolvedValue(undefined) };
    const deletion = { restoreByAdmin: vi.fn().mockResolvedValue(true) };
    const service = new AdminOwnersService(prisma as never, {} as never, sessions as never, {} as never, undefined, undefined, deletion as never);
    return { service, prisma, sessions, deletion };
  };

  it('suspends without signing out when the admin unticks it', async () => {
    const { service, sessions } = setup({ status: 'ACTIVE' });
    await service.suspend('u1', { reason: 'Lost phone', signOutEverywhere: false }, 'admin-1');
    expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
  });

  it('signs out everywhere by default, device rows included', async () => {
    const { service, sessions, prisma } = setup({ status: 'ACTIVE' });
    await service.suspend('u1', { reason: 'Lost phone' }, 'admin-1');
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith('u1');
    expect(prisma.userSession.updateMany).toHaveBeenCalledWith({ where: { userId: 'u1', revokedAt: null }, data: { revokedAt: expect.any(Date) } });
  });

  it('will not suspend or turn on an account that is being deleted', async () => {
    await expect(setup({ status: 'PENDING_DELETION' }).service.suspend('u1', { reason: 'Spam invites' }, 'a')).rejects.toBeInstanceOf(ConflictException);
    await expect(setup({ status: 'PENDING_DELETION' }).service.activate('u1', 'a')).rejects.toBeInstanceOf(ConflictException);
    await expect(setup({ status: 'DELETED' }).service.activate('u1', 'a')).rejects.toBeInstanceOf(ConflictException);
  });

  it('cancels a deletion inside the 30 days, audited', async () => {
    const { service, prisma, deletion } = setup({ status: 'PENDING_DELETION', deletionScheduledFor: new Date('2026-11-01') });
    await expect(service.restore('u1', 'admin-1', '203.0.113.9')).resolves.toEqual({ id: 'u1', status: 'ACTIVE' });
    expect(deletion.restoreByAdmin).toHaveBeenCalledWith('u1');
    expect(prisma.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: 'OWNER_DELETION_CANCELLED', entityId: 'u1' });
  });

  it('refuses to cancel once the 30 days are over, or for an active account', async () => {
    const late = setup({ status: 'PENDING_DELETION' });
    late.deletion.restoreByAdmin.mockResolvedValue(false);
    await expect(late.service.restore('u1', 'a')).rejects.toBeInstanceOf(ConflictException);
    await expect(setup({ status: 'ACTIVE' }).service.restore('u1', 'a')).rejects.toBeInstanceOf(ConflictException);
  });

  it('signs out of every device and says how many', async () => {
    const { service, prisma, sessions } = setup({ status: 'ACTIVE' });
    await expect(service.signOutEverywhere('u1', 'admin-1')).resolves.toEqual({ signedOut: 2 });
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith('u1');
    expect(prisma.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: 'OWNER_SIGNED_OUT_EVERYWHERE' });
  });
});

describe('AdminNotesService', () => {
  const setup = (note: Record<string, unknown> | null) => {
    const prisma = {
      user: { findUnique: vi.fn().mockResolvedValue({ id: 'u1' }) },
      adminNote: {
        findFirst: vi.fn().mockResolvedValue(note),
        update: vi.fn().mockResolvedValue({}),
        create: vi.fn().mockResolvedValue({ id: 'n1', body: 'Prefers Bangla', createdAt: NOW, authorId: 'admin-1', author: { id: 'admin-1', name: 'Imran' } }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn((arg: unknown) => (typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as unknown[]))),
    };
    return { service: new AdminNotesService(prisma as never), prisma };
  };

  it('adds a note, audited, that its author may remove', async () => {
    const { service, prisma } = setup(null);
    const note = await service.add('u1', 'Prefers Bangla', { id: 'admin-1', role: 'SUPPORT_ADMIN' });
    expect(note).toMatchObject({ id: 'n1', canDelete: true, author: { name: 'Imran' } });
    expect(prisma.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: 'OWNER_NOTE_ADDED', entityId: 'u1' });
  });

  it("lets only the author or a super admin remove someone's note", async () => {
    const someone = { id: 'n1', authorId: 'admin-2', body: 'x' };
    await expect(setup(someone).service.remove('u1', 'n1', { id: 'admin-1', role: 'SUPPORT_ADMIN' })).rejects.toBeInstanceOf(ForbiddenException);
    const { service, prisma } = setup(someone);
    await expect(service.remove('u1', 'n1', { id: 'admin-9', role: 'SUPER_ADMIN' })).resolves.toEqual({ success: true });
    expect(prisma.adminNote.update).toHaveBeenCalledWith({ where: { id: 'n1' }, data: { deletedAt: expect.any(Date) } });
  });
});
