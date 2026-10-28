import { HttpException } from '@nestjs/common';
import { REFERRAL_DEFAULTS, type ReferralSettings } from '../settings/referral-settings.js';
import { WithdrawalsService } from './withdrawals.service.js';

const bkash = {
  id: 'm-1',
  userId: 'u-1',
  type: 'BKASH',
  accountName: 'Khaled Mahmud',
  walletNumber: '01711482915',
  bankName: null,
  branch: null,
  bankAccountType: null,
  accountNumber: null,
  routingNumber: null,
  deletedAt: null,
};

const commission = (id: string, amount: string, status = 'AVAILABLE') => ({
  id,
  kind: 'COMMISSION',
  status,
  rewardAmount: '0',
  commissionAmount: amount,
  paidOutAmount: '0',
  availableAt: new Date('2026-09-20T00:00:00Z'),
  createdAt: new Date('2026-09-10T00:00:00Z'),
});

const setup = ({
  settings = {} as Partial<ReferralSettings>,
  referrals = [commission('r-1', '540.00'), commission('r-2', '540.00'), commission('r-3', '144.00')] as unknown[],
  open = [] as unknown[],
  method = bkash as unknown,
  consumed = true,
} = {}) => {
  const created: Record<string, unknown>[] = [];
  const db = {
    user: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'u-1', name: 'Khaled Mahmud', email: 'khaled@gmail.com', phone: null, preferredLanguage: 'EN' }),
    },
    referral: { findMany: vi.fn().mockResolvedValue(referrals) },
    payoutRequest: {
      findMany: vi.fn().mockResolvedValue(open),
      create: vi.fn((args: { data: Record<string, unknown> }) => {
        created.push(args.data);
        return Promise.resolve({
          id: 'wd-1',
          number: 1048,
          status: 'REQUESTED',
          createdAt: new Date('2026-10-01T05:20:00.000Z'),
          approvedAt: null,
          paidAt: null,
          paidAmount: null,
          trxId: null,
          rejectedAt: null,
          rejectReason: null,
          cancelledAt: null,
          incomeTransactionId: null,
          ...args.data,
        });
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findFirst: vi.fn().mockResolvedValue({ status: 'APPROVED' }),
      findUniqueOrThrow: vi.fn(),
    },
    payoutMethod: { findFirst: vi.fn().mockResolvedValue(method) },
    businessMember: { findFirst: vi.fn().mockResolvedValue(null) },
    account: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const settingsService = { getReferralSettings: vi.fn().mockResolvedValue({ ...REFERRAL_DEFAULTS, ...settings }) };
  const transactions = { withLocks: vi.fn((_keys: string[], work: (tx: typeof db) => Promise<unknown>) => work(db)) };
  const codes = {
    issue: vi.fn().mockResolvedValue({ challengeId: 'c-1' }),
    verify: vi.fn().mockResolvedValue({ id: 'c-1', payload: { amount: '1000.00', methodId: 'm-1', income: null } }),
    consume: vi.fn().mockResolvedValue(consumed),
  };
  const service = new WithdrawalsService(db as never, settingsService as never, transactions as never, codes as never);
  return { service, db, codes, transactions, created };
};

const reasonOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return ((error as HttpException).getResponse() as { reason?: string }).reason ?? (error as Error).message;
  }
  throw new Error('expected a refusal');
};

describe('WithdrawalsService.start', () => {
  it('sends a code for a request within the balance, keeping what it confirms', async () => {
    const { service, codes } = setup();
    await service.start('u-1', { amount: 1000, methodId: 'm-1' });
    expect(codes.issue).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u-1' }),
      'PAYOUT_REQUEST',
      { amount: '1000.00', methodId: 'm-1', income: null },
      { en: 'withdraw ৳ 1,000 to bKash 01711-•••915', bn: 'বিকাশ 01711-•••915-এ ৳ ১,০০০ তোলা' },
    );
  });

  it('refuses less than the minimum, more than the balance, and no more than the fee', async () => {
    expect(await reasonOf(setup().service.start('u-1', { amount: 499, methodId: 'm-1' }))).toBe('BELOW_MINIMUM');
    expect(await reasonOf(setup().service.start('u-1', { amount: 1224.01, methodId: 'm-1' }))).toBe('ABOVE_AVAILABLE');
    expect(await reasonOf(setup({ settings: { minWithdrawal: 10, withdrawalFee: 20 } }).service.start('u-1', { amount: 20, methodId: 'm-1' }))).toBe(
      'FEE_EXCEEDS_AMOUNT',
    );
  });

  it('counts money set aside by an open request as gone', async () => {
    const { service } = setup({ open: [{ id: 'wd-0', number: 1, status: 'REQUESTED', amount: '1000.00', createdAt: new Date() }] });
    expect(await reasonOf(service.start('u-1', { amount: 500, methodId: 'm-1' }))).toBe('ABOVE_AVAILABLE');
  });

  it('refuses a method the program does not pay to, or one that is gone', async () => {
    expect(await reasonOf(setup({ settings: { payoutMethods: ['NAGAD', 'BANK'] } }).service.start('u-1', { amount: 500, methodId: 'm-1' }))).toBe(
      'METHOD_NOT_ALLOWED',
    );
    expect(await reasonOf(setup({ method: null }).service.start('u-1', { amount: 500, methodId: 'm-x' }))).toBe('METHOD_NOT_FOUND');
  });

  it('still lets members withdraw what they earned while the program is paused', async () => {
    await expect(setup({ settings: { programLive: false } }).service.start('u-1', { amount: 500, methodId: 'm-1' })).resolves.toBeDefined();
  });

  it('refuses income to a workspace the member does not keep the books for', async () => {
    const { service } = setup();
    expect(await reasonOf(service.start('u-1', { amount: 500, methodId: 'm-1', income: { businessId: 'b-x', accountId: 'a-1' } }))).toBe('INCOME_NOT_ALLOWED');
  });
});

describe('WithdrawalsService.confirm', () => {
  it('uses the code up and makes a REQUESTED request with a copy of the method', async () => {
    const { service, codes, created, transactions } = setup();
    const view = await service.confirm('u-1', { challengeId: 'c-1', code: '481527' });
    expect(codes.verify).toHaveBeenCalledWith('u-1', 'c-1', 'PAYOUT_REQUEST', '481527');
    expect(transactions.withLocks).toHaveBeenCalledWith(['referrals:u-1'], expect.any(Function));
    expect(codes.consume).toHaveBeenCalled();
    expect(created[0]).toMatchObject({
      userId: 'u-1',
      methodId: 'm-1',
      methodSnapshot: expect.objectContaining({ type: 'BKASH', walletNumber: '01711482915' }),
    });
    expect(view).toMatchObject({
      displayId: 'WD-1048',
      amount: '1000.00',
      receiveAmount: '1000.00',
      status: 'REQUESTED',
      expectedBy: '2026-10-06',
      canCancel: true,
    });
  });

  it('makes nothing for a code already used (a double submit)', async () => {
    const { service, created } = setup({ consumed: false });
    expect(await reasonOf(service.confirm('u-1', { challengeId: 'c-1', code: '481527' }))).toBe('CODE_USED');
    expect(created).toHaveLength(0);
  });

  it('checks the balance again when the code is used', async () => {
    const { service, created } = setup({ referrals: [commission('r-1', '540.00')] });
    expect(await reasonOf(service.confirm('u-1', { challengeId: 'c-1', code: '481527' }))).toBe('ABOVE_AVAILABLE');
    expect(created).toHaveLength(0);
  });
});

describe('WithdrawalsService.cancel', () => {
  it('cancels only a request nobody has approved', async () => {
    const { service, db } = setup();
    db.payoutRequest.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.cancel('u-1', 'wd-1')).rejects.toThrow('this one is approved');
    expect(db.payoutRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'wd-1', userId: 'u-1', status: 'REQUESTED' },
      data: { status: 'CANCELLED', cancelledAt: expect.any(Date) },
    });
  });
});
