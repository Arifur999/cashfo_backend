import { ConflictException } from '@nestjs/common';
import { REFERRAL_DEFAULTS } from '../settings/referral-settings.js';
import { AdminReferralsService } from './admin-referrals.service.js';

const snapshot = {
  type: 'NAGAD',
  accountName: 'Nasrin Akter',
  walletNumber: '01819552310',
  bankName: null,
  branch: null,
  bankAccountType: null,
  accountNumber: null,
  routingNumber: null,
};

const payout = (over: Record<string, unknown> = {}) => ({
  id: 'wd-1',
  number: 1047,
  userId: 'u-nasrin',
  amount: '2160.00',
  fee: '0.00',
  methodId: 'm-1',
  methodSnapshot: snapshot,
  status: 'APPROVED',
  incomeBusinessId: null,
  incomeAccountId: null,
  incomeTransactionId: null,
  codeConfirmedAt: new Date('2026-09-30T10:05:00.000Z'),
  approvedAt: new Date('2026-09-30T12:00:00.000Z'),
  approvedBy: 'admin-1',
  paidAt: null,
  paidAmount: null,
  trxId: null,
  rejectedAt: null,
  rejectReason: null,
  cancelledAt: null,
  processedBy: null,
  createdAt: new Date('2026-09-30T10:05:00.000Z'),
  updatedAt: new Date(),
  ...over,
});

const commission = (id: string, amount: string, availableAt: string) => ({
  id,
  kind: 'COMMISSION',
  status: 'AVAILABLE',
  rewardAmount: '0',
  commissionAmount: amount,
  paidOutAmount: '0',
  availableAt: new Date(availableAt),
  createdAt: new Date(availableAt),
});

const setup = ({ claimed = 1, row = payout() as Record<string, unknown>, available = [] as unknown[], incomeMember = null as unknown } = {}) => {
  const tx = {
    payoutRequest: {
      updateMany: vi.fn().mockResolvedValue({ count: claimed }),
      findUnique: vi.fn().mockResolvedValue(row),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ ...row, status: 'PAID', paidAmount: '2160.00', trxId: '8K2M4N7QXA', paidAt: new Date() }),
      update: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
    },
    referral: { findMany: vi.fn().mockResolvedValue(available), update: vi.fn().mockResolvedValue({}), findUniqueOrThrow: vi.fn() },
    payoutAllocation: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    businessMember: { findFirst: vi.fn().mockResolvedValue(incomeMember) },
    account: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'cash',
        businessId: 'b-1',
        status: 'ACTIVE',
        accountType: 'ASSET',
        accountSubtype: 'cash',
        isSystemAccount: true,
        name: 'Cash',
      }),
      findFirst: vi.fn().mockResolvedValue({ id: 'bonus' }),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = { ...tx };
  const transactions = {
    withLocks: vi.fn((_keys: string[], work: (client: typeof tx) => Promise<unknown>) => work(tx)),
    createTransaction: vi.fn().mockResolvedValue({ id: 'txn-1' }),
  };
  const notices = { payoutPaid: vi.fn(), payoutRejected: vi.fn(), payoutApproved: vi.fn(), bell: vi.fn() };
  const settings = { getReferralSettings: vi.fn().mockResolvedValue(REFERRAL_DEFAULTS) };
  const service = new AdminReferralsService(prisma as never, settings as never, transactions as never, notices as never);
  // The detail read after each write is not what these tests are about.
  vi.spyOn(service, 'getPayout').mockResolvedValue({} as never);
  return { service, tx, transactions, notices };
};

const actor = { adminId: 'admin-1', ipAddress: '1.2.3.4' };

describe('AdminReferralsService status moves', () => {
  it('approves only a REQUESTED request, with an audit entry', async () => {
    const { service, tx, notices } = setup({ row: payout({ status: 'REQUESTED' }) });
    await service.approve('wd-1', actor);
    expect(tx.payoutRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'wd-1', status: 'REQUESTED' },
      data: expect.objectContaining({ status: 'APPROVED', approvedBy: 'admin-1' }),
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'REFERRAL_PAYOUT_APPROVED', entityType: 'PayoutRequest', ipAddress: '1.2.3.4' }),
    });
    expect(notices.payoutApproved).toHaveBeenCalled();
  });

  it('refuses to approve a request in any other state', async () => {
    const { service } = setup({ claimed: 0, row: payout({ status: 'PAID' }) });
    await expect(service.approve('wd-1', actor)).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a requested or approved request, which gives the money back, and tells the member', async () => {
    const { service, tx, notices } = setup();
    await service.reject('wd-1', 'The account name did not match', actor);
    expect(tx.payoutRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'wd-1', status: { in: ['REQUESTED', 'APPROVED'] } },
      data: expect.objectContaining({ status: 'REJECTED', rejectReason: 'The account name did not match' }),
    });
    expect(notices.payoutRejected).toHaveBeenCalledWith(expect.objectContaining({ displayId: 'WD-1047', rejectReason: 'The account name did not match' }));
  });
});

describe('AdminReferralsService.markPaid', () => {
  const four = [
    commission('r-1', '540.00', '2026-09-10T00:00:00Z'),
    commission('r-2', '540.00', '2026-09-12T00:00:00Z'),
    commission('r-3', '540.00', '2026-09-14T00:00:00Z'),
    commission('r-4', '540.00', '2026-09-16T00:00:00Z'),
    commission('r-5', '540.00', '2026-09-18T00:00:00Z'),
  ];

  it('takes the amount from the oldest commissions and records which', async () => {
    const { service, tx, notices } = setup({ available: four });
    await service.markPaid('wd-1', { trxId: '8K2M4N7QXA' }, actor);
    expect(tx.payoutRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'wd-1', status: 'APPROVED' },
      data: expect.objectContaining({ status: 'PAID', trxId: '8K2M4N7QXA', processedBy: 'admin-1' }),
    });
    const closed = tx.referral.update.mock.calls.map((call) => call[0] as { where: { id: string }; data: { status?: string } });
    expect(closed.map((c) => c.where.id)).toEqual(['r-1', 'r-2', 'r-3', 'r-4']);
    expect(closed.every((c) => c.data.status === 'PAID_OUT')).toBe(true);
    expect(tx.payoutAllocation.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([expect.objectContaining({ payoutId: 'wd-1', referralId: 'r-4' })]),
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'REFERRAL_PAYOUT_PAID' }) });
    expect(notices.payoutPaid).toHaveBeenCalled();
  });

  it('adds the income to the member’s wallet when they asked for it', async () => {
    const { service, transactions, tx } = setup({
      available: four,
      row: payout({ incomeBusinessId: 'b-1', incomeAccountId: 'cash' }),
      incomeMember: { business: { id: 'b-1', name: 'Personal', type: 'PERSONAL', deletedAt: null } },
    });
    await service.markPaid('wd-1', { trxId: '8K2M4N7QXA', paidAmount: 2160, notifyUser: false }, actor);
    expect(transactions.withLocks).toHaveBeenCalledWith(['referrals:u-nasrin', 'referral-bonus:b-1'], expect.any(Function));
    expect(transactions.createTransaction).toHaveBeenCalledWith(
      'b-1',
      expect.objectContaining({ transactionType: 'INCOME', description: 'Referral payout WD-1047' }),
      'u-nasrin',
      tx,
    );
    expect(tx.payoutRequest.update).toHaveBeenCalledWith({ where: { id: 'wd-1' }, data: { incomeTransactionId: 'txn-1' } });
  });

  it('refuses a request that is not approved, and an amount over the request', async () => {
    await expect(
      setup({ claimed: 0, row: payout({ status: 'REQUESTED' }), available: four }).service.markPaid('wd-1', { trxId: 'X' }, actor),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(setup({ available: four }).service.markPaid('wd-1', { trxId: 'X', paidAmount: 2161 }, actor)).rejects.toThrow('at most');
  });

  it('rolls back when the commissions no longer cover it', async () => {
    const { service, notices } = setup({ available: four.slice(0, 2) });
    await expect(service.markPaid('wd-1', { trxId: 'X' }, actor)).rejects.toBeInstanceOf(ConflictException);
    expect(notices.payoutPaid).not.toHaveBeenCalled();
  });
});
