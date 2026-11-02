import { BadRequestException, ConflictException } from '@nestjs/common';
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
  requestedAmount: '2160.00',
  lineIds: ['c-1', 'c-2', 'c-3', 'c-4'],
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

// Four lines of ৳ 540 in the request.
const LINES = ['c-1', 'c-2', 'c-3', 'c-4'].map((id) => ({ id, amount: '540.00' }));

const setup = ({ claimed = 1, row = payout() as Record<string, unknown>, lines = LINES as unknown[], incomeMember = null as unknown } = {}) => {
  const tx = {
    payoutRequest: {
      updateMany: vi.fn().mockResolvedValue({ count: claimed }),
      findUnique: vi.fn().mockResolvedValue(row),
      findUniqueOrThrow: vi.fn().mockResolvedValue(row),
      update: vi.fn().mockResolvedValue({}),
    },
    referralCommission: {
      findMany: vi.fn().mockResolvedValue(lines),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
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

describe('AdminReferralsService.approve', () => {
  it('approves a REQUESTED request whole, with an audit entry', async () => {
    const { service, tx, notices } = setup({ row: payout({ status: 'REQUESTED' }) });
    await service.approve('wd-1', {}, actor);
    expect(tx.payoutRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'wd-1', status: 'REQUESTED' },
      data: expect.objectContaining({ status: 'APPROVED', approvedBy: 'admin-1', amount: expect.objectContaining({}) }),
    });
    expect(String(tx.payoutRequest.updateMany.mock.calls[0][0].data.amount)).toBe('2160');
    expect(tx.referralCommission.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'REFERRAL_PAYOUT_APPROVED', entityType: 'PayoutRequest', ipAddress: '1.2.3.4' }),
    });
    expect(notices.payoutApproved).toHaveBeenCalled();
    expect(notices.bell).not.toHaveBeenCalled();
  });

  it('holds back unticked lines for a check and approves the rest', async () => {
    const { service, tx, notices } = setup({ row: payout({ status: 'REQUESTED' }) });
    await service.approve('wd-1', { excludedIds: ['c-2', 'c-4'] }, actor);
    expect(String(tx.payoutRequest.updateMany.mock.calls[0][0].data.amount)).toBe('1080');
    expect(tx.referralCommission.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['c-2', 'c-4'] }, payoutId: 'wd-1', status: 'IN_WITHDRAWAL' },
      data: { status: 'UNDER_CHECK' },
    });
    expect(notices.bell).toHaveBeenCalledWith(
      'u-nasrin',
      'REFERRAL',
      'payout:wd-1:held',
      expect.objectContaining({ event: 'COMMISSION_UNDER_CHECK', count: 2 }),
    );
  });

  it('refuses a line from elsewhere, or holding back every line', async () => {
    await expect(setup({ row: payout({ status: 'REQUESTED' }) }).service.approve('wd-1', { excludedIds: ['c-9'] }, actor)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(setup({ row: payout({ status: 'REQUESTED' }) }).service.approve('wd-1', { excludedIds: ['c-1', 'c-2', 'c-3', 'c-4'] }, actor)).rejects.toThrow(
      'Reject the request instead',
    );
  });

  it('refuses to approve a request in any other state', async () => {
    const { service, tx } = setup({ row: payout({ status: 'PAID' }) });
    await expect(service.approve('wd-1', {}, actor)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.payoutRequest.updateMany).not.toHaveBeenCalled();
  });
});

describe('AdminReferralsService.reject', () => {
  it('rejects a requested or approved request, gives its lines back, and tells the member', async () => {
    const { service, tx, notices } = setup();
    await service.reject('wd-1', 'The account name did not match', actor);
    expect(tx.payoutRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'wd-1', status: { in: ['REQUESTED', 'APPROVED'] } },
      data: expect.objectContaining({ status: 'REJECTED', rejectReason: 'The account name did not match' }),
    });
    expect(tx.referralCommission.updateMany).toHaveBeenCalledWith({
      where: { payoutId: { in: ['wd-1'] }, status: 'IN_WITHDRAWAL' },
      data: { status: 'AVAILABLE', payoutId: null },
    });
    expect(notices.payoutRejected).toHaveBeenCalledWith(expect.objectContaining({ displayId: 'WD-1047', rejectReason: 'The account name did not match' }));
  });
});

describe('AdminReferralsService.markPaid', () => {
  it('marks its lines paid out, with an audit entry and the member told', async () => {
    const { service, tx, notices } = setup();
    await service.markPaid('wd-1', { trxId: '8K2M4N7QXA' }, actor);
    expect(tx.payoutRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'wd-1', status: 'APPROVED' },
      data: expect.objectContaining({ status: 'PAID', trxId: '8K2M4N7QXA', processedBy: 'admin-1' }),
    });
    expect(tx.referralCommission.updateMany).toHaveBeenCalledWith({
      where: { payoutId: 'wd-1', status: 'IN_WITHDRAWAL' },
      data: expect.objectContaining({ status: 'PAID_OUT' }),
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'REFERRAL_PAYOUT_PAID' }) });
    expect(notices.payoutPaid).toHaveBeenCalled();
  });

  it('adds the income to the member’s wallet when they asked for it', async () => {
    const { service, transactions, tx } = setup({
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
    await expect(setup({ row: payout({ status: 'REQUESTED' }) }).service.markPaid('wd-1', { trxId: 'X' }, actor)).rejects.toBeInstanceOf(ConflictException);
    const over = setup();
    await expect(over.service.markPaid('wd-1', { trxId: 'X', paidAmount: 2161 }, actor)).rejects.toThrow('at most');
    expect(over.tx.payoutRequest.updateMany).not.toHaveBeenCalled();
  });
});
