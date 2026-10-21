import { ConflictException } from '@nestjs/common';
import { BillingCycle } from '@prisma/client';
import type { CreatePlanDto } from './dto/create-plan.dto.js';
import { SubscriptionPlansService } from './subscription-plans.service.js';

const FEATURES: CreatePlanDto['featureLimits'] = {
  maxWorkspaces: 3,
  maxBusinessWorkspaces: 1,
  maxTransactionsPerMonth: -1,
  advancedReports: true,
  pdfExport: true,
  multiUser: false,
  incomeGoalTracking: false,
};

// The admin making the plan, and where from.
const ADMIN = 'admin-1';
const IP = '127.0.0.1';

const dto = (overrides: Partial<CreatePlanDto> = {}): CreatePlanDto => ({
  name: 'Quarterly Pro',
  slug: 'quarterly-pro',
  billingCycle: BillingCycle.MONTHLY,
  price: 799,
  featureLimits: FEATURES,
  ...overrides,
});

// `highest` is the largest displayOrder among the plans already there
// (null when there are none); `taken` is a plan already using the slug.
// The plan and its audit row are written through `tx`, the transaction.
const setup = ({ highest = 3 as number | null, taken = null as object | null } = {}) => {
  const tx = {
    subscriptionPlan: {
      create: vi.fn((args: { data: Record<string, unknown> }) => Promise.resolve({ id: 'plan-new', ...args.data })),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    subscriptionPlan: {
      findUnique: vi.fn().mockResolvedValue(taken),
      aggregate: vi.fn().mockResolvedValue({ _max: { displayOrder: highest } }),
    },
    $transaction: vi.fn((work: (client: typeof tx) => unknown) => work(tx)),
  };
  return { service: new SubscriptionPlansService(prisma as never), prisma, tx };
};

describe('SubscriptionPlansService.create displayOrder', () => {
  it('puts a plan sent without a place after the last plan', async () => {
    const { service, prisma } = setup({ highest: 3 });

    const plan = await service.create(dto(), ADMIN, IP);

    expect(prisma.subscriptionPlan.aggregate).toHaveBeenCalledWith({ _max: { displayOrder: true } });
    expect(plan.displayOrder).toBe(4);
  });

  it('gives the very first plan 0, as before', async () => {
    const { service } = setup({ highest: null });
    expect((await service.create(dto(), ADMIN, IP)).displayOrder).toBe(0);
  });

  it('goes one past the highest even when every order is negative', async () => {
    const { service } = setup({ highest: -2 });
    expect((await service.create(dto(), ADMIN, IP)).displayOrder).toBe(-1);
  });

  it('keeps a place that was sent, 0 included, without reading the others', async () => {
    const { service, prisma } = setup({ highest: 3 });

    expect((await service.create(dto({ displayOrder: 0 }), ADMIN, IP)).displayOrder).toBe(0);
    expect((await service.create(dto({ displayOrder: 7 }), ADMIN, IP)).displayOrder).toBe(7);
    expect(prisma.subscriptionPlan.aggregate).not.toHaveBeenCalled();
  });

  it('still refuses a slug in use before creating anything', async () => {
    const { service, prisma, tx } = setup({ taken: { id: 'plan-old', slug: 'quarterly-pro' } });

    await expect(service.create(dto(), ADMIN, IP)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.subscriptionPlan.create).not.toHaveBeenCalled();
  });

  it('fills the other defaults as before', async () => {
    const { service, tx } = setup();

    await service.create(dto(), ADMIN, IP);

    expect(tx.subscriptionPlan.create).toHaveBeenCalledWith({
      data: {
        name: 'Quarterly Pro',
        slug: 'quarterly-pro',
        billingCycle: BillingCycle.MONTHLY,
        price: 799,
        currency: 'BDT',
        trialDays: 0,
        isActive: true,
        displayOrder: 4,
        featureLimits: FEATURES,
      },
    });
  });
});

describe('SubscriptionPlansService.create audit', () => {
  it('records a PLAN_CREATED row with who, from where, and the plan as saved, in the same transaction', async () => {
    const { service, prisma, tx } = setup({ highest: 3 });

    const plan = await service.create(dto(), ADMIN, IP);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        adminUserId: ADMIN,
        action: 'PLAN_CREATED',
        entityType: 'SubscriptionPlan',
        entityId: 'plan-new',
        newValue: plan,
        ipAddress: IP,
      },
    });
  });

  it('still answers with the plan itself, not wrapped', async () => {
    const { service, tx } = setup({ highest: 3 });

    const plan = await service.create(dto(), ADMIN, IP);

    expect(plan).toBe(await tx.subscriptionPlan.create.mock.results[0].value);
  });

  it('writes no audit row when the slug is refused', async () => {
    const { service, tx } = setup({ taken: { id: 'plan-old', slug: 'quarterly-pro' } });

    await expect(service.create(dto(), ADMIN, IP)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('fails, so the transaction drops the plan too, when the audit row cannot be written', async () => {
    const { service, tx } = setup();
    tx.auditLog.create.mockRejectedValueOnce(new Error('audit write failed'));

    await expect(service.create(dto(), ADMIN, IP)).rejects.toThrow('audit write failed');
  });
});
