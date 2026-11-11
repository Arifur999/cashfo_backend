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

type Line = {
  id: string;
  status: string;
  amount: string;
  availableAt: Date;
  createdAt: Date;
  kind: string;
  paidAmount: string;
  payment: null;
  referral: { referredUser: { name: string } };
};
const line = (id: string, amount: string, status = 'AVAILABLE', day = 20): Line => ({
  id,
  status,
  amount,
  kind: 'FIRST',
  paidAmount: '1719.00',
  payment: null,
  referral: { referredUser: { name: 'Nusrat Jahan' } },
  availableAt: new Date(`2026-09-${day}T00:00:00Z`),
  createdAt: new Date(`2026-09-${String(day - 7).padStart(2, '0')}T00:00:00Z`),
});
const LINES = [
  line('c-1', '540.00', 'AVAILABLE', 12),
  line('c-2', '540.00', 'AVAILABLE', 14),
  line('c-3', '144.00', 'AVAILABLE', 16),
  line('c-4', '343.00', 'ON_HOLD', 28),
];

const setup = ({
  settings = {} as Partial<ReferralSettings>,
  lines = LINES,
  method = bkash as unknown,
  consumed = true,
  confirms = { commissionIds: ['c-1', 'c-2'], methodId: 'm-1', income: null } as Record<string, unknown>,
} = {}) => {
  const created: Record<string, unknown>[] = [];
  const db = {
    user: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'u-1', name: 'Khaled Mahmud', email: 'khaled@gmail.com', phone: null, preferredLanguage: 'EN' }),
    },
    referralCommission: {
      findMany: vi.fn((args: { where: { id?: { in: string[] }; status?: string } }) => {
        const where = args.where;
        return Promise.resolve(lines.filter((l) => (!where.id || where.id.in.includes(l.id)) && (!where.status || l.status === where.status)));
      }),
      updateMany: vi.fn((args: { where: { id?: { in: string[] } } }) => Promise.resolve({ count: args.where.id?.in.length ?? 0 })),
    },
    payoutRequest: {
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
    issue: vi.fn().mockResolvedValue({ challengeId: 'ch-1' }),
    verify: vi.fn().mockResolvedValue({ id: 'ch-1', payload: confirms }),
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
  it('sends a code for the ticked lines, keeping what it confirms', async () => {
    const { service, codes } = setup();
    await service.start('u-1', { commissionIds: ['c-2', 'c-1'], methodId: 'm-1' });
    expect(codes.issue).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u-1' }),
      'PAYOUT_REQUEST',
      { commissionIds: ['c-1', 'c-2'], methodId: 'm-1', income: null },
      { en: 'withdraw Tk 1,080 to bKash 01711-•••915', bn: 'বিকাশ 01711-•••915-এ ৳ ১,০৮০ তোলা' },
    );
  });

  it('takes the oldest lines that cover an amount from an older app', async () => {
    const { service, codes } = setup();
    await service.start('u-1', { amount: 600, methodId: 'm-1' });
    expect(codes.issue.mock.calls[0][2]).toMatchObject({ commissionIds: ['c-1', 'c-2'] });
  });

  it('refuses lines that are not available, less than the minimum, and no more than the fee', async () => {
    expect(await reasonOf(setup().service.start('u-1', { commissionIds: ['c-1', 'c-4'], methodId: 'm-1' }))).toBe('LINES_CHANGED');
    expect(await reasonOf(setup().service.start('u-1', { commissionIds: ['c-9'], methodId: 'm-1' }))).toBe('LINES_CHANGED');
    expect(await reasonOf(setup().service.start('u-1', { commissionIds: ['c-3'], methodId: 'm-1' }))).toBe('BELOW_MINIMUM');
    expect(
      await reasonOf(setup({ settings: { minWithdrawal: 10, withdrawalFee: 144 } }).service.start('u-1', { commissionIds: ['c-3'], methodId: 'm-1' })),
    ).toBe('FEE_EXCEEDS_AMOUNT');
  });

  it('allows Tk 300 by default', async () => {
    const small = [line('s-1', '171.00'), line('s-2', '129.00')];
    await expect(setup({ lines: small }).service.start('u-1', { commissionIds: ['s-1', 's-2'], methodId: 'm-1' })).resolves.toBeDefined();
  });

  it('refuses a method the program does not pay to, or one that is gone', async () => {
    const ids = { commissionIds: ['c-1'], methodId: 'm-1' };
    expect(await reasonOf(setup({ settings: { payoutMethods: ['NAGAD', 'BANK'] } }).service.start('u-1', ids))).toBe('METHOD_NOT_ALLOWED');
    expect(await reasonOf(setup({ method: null }).service.start('u-1', ids))).toBe('METHOD_NOT_FOUND');
  });

  it('still lets members withdraw what they earned while the program is paused', async () => {
    await expect(setup({ settings: { programLive: false } }).service.start('u-1', { commissionIds: ['c-1'], methodId: 'm-1' })).resolves.toBeDefined();
  });

  it('refuses income to a workspace the member does not keep the books for', async () => {
    const { service } = setup();
    expect(await reasonOf(service.start('u-1', { commissionIds: ['c-1'], methodId: 'm-1', income: { businessId: 'b-x', accountId: 'a-1' } }))).toBe(
      'INCOME_NOT_ALLOWED',
    );
  });
});

describe('WithdrawalsService.confirm', () => {
  it('uses the code up and makes a REQUESTED request of its lines', async () => {
    const { service, codes, created, transactions, db } = setup();
    const view = await service.confirm('u-1', { challengeId: 'ch-1', code: '481527' });
    expect(codes.verify).toHaveBeenCalledWith('u-1', 'ch-1', 'PAYOUT_REQUEST', '481527');
    expect(transactions.withLocks).toHaveBeenCalledWith(['referrals:u-1'], expect.any(Function));
    expect(codes.consume).toHaveBeenCalled();
    expect(created[0]).toMatchObject({
      userId: 'u-1',
      methodId: 'm-1',
      methodSnapshot: expect.objectContaining({ type: 'BKASH', walletNumber: '01711482915' }),
    });
    expect(String(created[0].amount)).toBe('1080');
    expect(String(created[0].requestedAmount)).toBe('1080');
    expect(db.referralCommission.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['c-1', 'c-2'] }, referrerId: 'u-1', status: 'AVAILABLE' },
      data: { status: 'IN_WITHDRAWAL', payoutId: 'wd-1' },
    });
    expect(view).toMatchObject({
      displayId: 'WD-1048',
      amount: '1080.00',
      receiveAmount: '1080.00',
      status: 'REQUESTED',
      expectedBy: '2026-10-06',
      canCancel: true,
    });
    expect(created[0].lineIds).toEqual(['c-1', 'c-2']);
    expect(view?.lines.map((l) => l.id)).toEqual(['c-1', 'c-2']);
  });

  it('makes nothing for a code already used (a double submit)', async () => {
    const { service, created } = setup({ consumed: false });
    expect(await reasonOf(service.confirm('u-1', { challengeId: 'ch-1', code: '481527' }))).toBe('CODE_USED');
    expect(created).toHaveLength(0);
  });

  it('checks the lines again when the code is used', async () => {
    const { service, created } = setup({ lines: [line('c-1', '540.00'), line('c-2', '540.00', 'IN_WITHDRAWAL')] });
    expect(await reasonOf(service.confirm('u-1', { challengeId: 'ch-1', code: '481527' }))).toBe('LINES_CHANGED');
    expect(created).toHaveLength(0);
  });

  it('refuses a code an older app made for an amount', async () => {
    const { service } = setup({ confirms: { amount: '1000.00', methodId: 'm-1', income: null } });
    expect(await reasonOf(service.confirm('u-1', { challengeId: 'ch-1', code: '481527' }))).toBe('CODE_USED');
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
    expect(db.referralCommission.updateMany).not.toHaveBeenCalled();
  });

  it('gives the lines of a cancelled request back', async () => {
    const { service, db } = setup();
    db.payoutRequest.findUniqueOrThrow.mockResolvedValue({
      id: 'wd-1',
      number: 1048,
      status: 'CANCELLED',
      amount: '1080.00',
      fee: '0',
      methodSnapshot: bkash,
      createdAt: new Date(),
      lineIds: ['c-1', 'c-2'],
    });
    await service.cancel('u-1', 'wd-1');
    expect(db.referralCommission.updateMany).toHaveBeenCalledWith({
      where: { payoutId: { in: ['wd-1'] }, status: 'IN_WITHDRAWAL' },
      data: { status: 'AVAILABLE', payoutId: null },
    });
  });
});
