import { AdminOwnersService } from './admin-owners.service.js';

// A live workspace as Prisma includes it, plan and all.
const workspace = (
  id: string,
  name: string,
  over: Partial<{ type: string; isDefault: boolean; planId: string | null; plan: { name: string } | null }> = {},
) => ({
  id,
  name,
  type: 'BUSINESS',
  isDefault: false,
  planId: null,
  plan: null,
  pinHash: null,
  deletedAt: null,
  ...over,
});
type Workspace = ReturnType<typeof workspace>;

const owner = (ownedBusinesses: Workspace[]) => ({
  id: 'u1',
  name: 'Nusrat Jahan',
  email: 'nusrat@example.com',
  phone: null,
  status: 'ACTIVE',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  lastLoginAt: null,
  ownedBusinesses,
});

// The personal workspace under a name of the owner's own, after a shop.
const renamedPersonal = [
  workspace('ws-shop', 'Jahan Boutique'),
  workspace('ws-own', 'আমার হিসাব', { type: 'PERSONAL', isDefault: true, planId: 'plan-free', plan: { name: 'Free' } }),
];

const emptyExtras = () => ({
  account: { groupBy: vi.fn().mockResolvedValue([]) },
  transaction: { count: vi.fn().mockResolvedValue(0), groupBy: vi.fn().mockResolvedValue([]) },
  referral: { findMany: vi.fn().mockResolvedValue([]) },
  referralCommission: { groupBy: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null) },
  payoutRequest: { findMany: vi.fn().mockResolvedValue([]) },
  payment: { aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null }, _count: 0 }), findFirst: vi.fn().mockResolvedValue(null) },
  supportTicket: { findMany: vi.fn().mockResolvedValue([]), groupBy: vi.fn().mockResolvedValue([]) },
  userSession: { findMany: vi.fn().mockResolvedValue([]) },
  authSession: { findMany: vi.fn().mockResolvedValue([]) },
  adminNote: { count: vi.fn().mockResolvedValue(0) },
  coupon: { findUnique: vi.fn().mockResolvedValue(null) },
});

const reads = (ownedBusinesses: Workspace[]) => {
  const row = owner(ownedBusinesses);
  const prisma = {
    user: {
      findMany: vi.fn().mockResolvedValue([row]),
      findUnique: vi.fn().mockResolvedValue(row),
      count: vi.fn().mockResolvedValue(1),
      groupBy: vi.fn().mockResolvedValue([{ status: 'ACTIVE', _count: 1 }]),
    },
    auditLog: { findMany: vi.fn().mockResolvedValue([]) },
    // The detail page's extra cards (owner-detail.ts): nothing yet.
    ...emptyExtras(),
  };
  return { service: new AdminOwnersService(prisma as never, {} as never, {} as never, {} as never), prisma };
};

describe('AdminOwnersService.list', () => {
  it('says what kind of workspace a row shows, so a renamed personal one still reads as personal', async () => {
    const { service } = reads(renamedPersonal);
    const { items } = await service.list({});
    expect(items[0]).toMatchObject({
      businessId: 'ws-own',
      businessName: 'আমার হিসাব',
      businessType: 'PERSONAL',
      businessIsDefault: true,
      planName: 'Free',
      workspaceCount: 2,
    });
  });

  it('says so when the row shows a workspace that is not the default one', async () => {
    const { service } = reads([workspace('ws-shop', 'Jahan Boutique')]);
    const { items } = await service.list({});
    expect(items[0]).toMatchObject({ businessId: 'ws-shop', businessType: 'BUSINESS', businessIsDefault: false });
  });

  it('gives the end of a running trial, and nothing for one that has run out or a paid plan', async () => {
    const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const past = new Date(Date.now() - 60 * 1000);
    const rows = [
      { status: 'TRIALING', trialEndsAt: future },
      { status: 'TRIALING', trialEndsAt: past },
      { status: 'ACTIVE', trialEndsAt: future },
      null,
    ];
    const { service, prisma } = reads(renamedPersonal);
    prisma.user.findMany.mockResolvedValue(rows.map((subscription) => ({ ...owner(renamedPersonal), subscription })));
    const { items } = await service.list({});
    expect(items.map((item) => item.trialEndsAt)).toEqual([future, null, null, null]);
  });
});

describe('AdminOwnersService.getById', () => {
  it('says what kind of workspace it shows, as the list does', async () => {
    const { service } = reads(renamedPersonal);
    await expect(service.getById('u1')).resolves.toMatchObject({ businessId: 'ws-own', businessType: 'PERSONAL', businessIsDefault: true });
  });

  it('has no kind for an owner with no live workspace', async () => {
    const { service } = reads([]);
    await expect(service.getById('u1')).resolves.toMatchObject({ businessId: null, businessName: null, businessType: null, businessIsDefault: null });
  });

  it("gives each history line the admin's reason and nothing else from the audit row", async () => {
    const { service, prisma } = reads(renamedPersonal);
    const at = new Date('2026-10-01T10:00:00.000Z');
    const log = (id: string, action: string, newValue: unknown) => ({ id, action, entityType: 'User', newValue, createdAt: at, adminUser: { id: 'a1', name: 'Imran' } });
    prisma.auditLog.findMany.mockResolvedValue([
      log('l1', 'USER_SUSPENDED', { status: 'SUSPENDED', reason: 'Spam invites', signedOutEverywhere: true }),
      log('l2', 'OWNER_DATA_EXPORTED', { fileName: 'export.zip' }),
      log('l3', 'USER_ACTIVATED', null),
    ]);
    const { activityLog } = await service.getById('u1');
    expect(activityLog.map((line) => line.reason)).toEqual(['Spam invites', null, null]);
    expect(activityLog[0]).not.toHaveProperty('newValue');
  });
});

describe('AdminOwnersService.exportOwnerData', () => {
  const owner = { id: 'u1', status: 'ACTIVE', ownedBusinesses: [] };
  const build = (consent: () => Promise<void>) => {
    const prisma = { user: { findUnique: vi.fn().mockResolvedValue(owner), findFirst: vi.fn().mockResolvedValue(owner) }, auditLog: { create: vi.fn() } };
    const supportAccess = { requireConsent: vi.fn(consent) };
    const accountExport = { export: vi.fn().mockResolvedValue({ fileName: 'smartly-data.zip', data: Buffer.from('zip') }) };
    const service = new AdminOwnersService(prisma as never, {} as never, {} as never, supportAccess as never, undefined, undefined, undefined, accountExport as never);
    return { service, supportAccess, accountExport, prisma };
  };

  it("downloads a customer's data only with the support code they made", async () => {
    const { service, supportAccess, accountExport } = build(() => Promise.resolve());
    await expect(service.exportOwnerData('u1', '123456', 'admin-1', '203.0.113.9')).resolves.toMatchObject({ fileName: 'smartly-data.zip' });
    expect(supportAccess.requireConsent).toHaveBeenCalledWith('u1', '123456', { adminId: 'admin-1', refused: 'OWNER_DATA_EXPORT_REFUSED', ipAddress: '203.0.113.9' });
    expect(accountExport.export).toHaveBeenCalledWith('u1');
  });

  it('downloads nothing when the code is refused', async () => {
    const { service, accountExport } = build(() => Promise.reject(new Error('refused')));
    await expect(service.exportOwnerData('u1', '000000', 'admin-1')).rejects.toThrow('refused');
    expect(accountExport.export).not.toHaveBeenCalled();
  });
});
