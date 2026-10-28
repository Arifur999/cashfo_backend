import { PaymentStatus } from '@prisma/client';
import { countByStatus, duplicateOf, paymentIdPrefix } from './payment-extras.js';

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 1, 4, minutes));
const paid = (
  id: string,
  minutes: number,
  overrides: Partial<{ userId: string | null; platformUserId: string | null; planId: string; status: PaymentStatus }> = {},
) => ({
  id,
  userId: null as string | null,
  platformUserId: 'mahbub' as string | null,
  planId: 'monthly',
  status: PaymentStatus.SUCCESS,
  createdAt: at(minutes),
  ...overrides,
});

describe('duplicateOf', () => {
  const first = paid('PAY-20930', 12);
  const second = paid('PAY-20931', 14);

  it('points the later of two quick payments at the earlier one, never the other way', () => {
    expect(duplicateOf(second, [first, second])).toBe('PAY-20930');
    expect(duplicateOf(first, [first, second])).toBeNull();
  });

  it('ignores another person, another plan, a failed try, or a payment long before', () => {
    expect(duplicateOf(second, [paid('x', 12, { platformUserId: 'nasrin' })])).toBeNull();
    expect(duplicateOf(second, [paid('x', 12, { planId: 'yearly' })])).toBeNull();
    expect(duplicateOf(second, [paid('x', 12, { status: PaymentStatus.FAILED })])).toBeNull();
    expect(duplicateOf(second, [paid('x', 3)])).toBeNull();
    expect(duplicateOf(paid('f', 14, { status: PaymentStatus.FAILED }), [first])).toBeNull();
  });

  it("keys a customer's payments on their User id, never mixing them with a sandbox id", () => {
    const customer = (id: string, minutes: number) => paid(id, minutes, { userId: 'u-nadia', platformUserId: null });
    expect(duplicateOf(customer('b', 14), [customer('a', 12)])).toBe('a');
    expect(duplicateOf(customer('b', 14), [paid('x', 12, { platformUserId: 'u-other' })])).toBeNull();
    expect(duplicateOf(paid('lone', 14, { platformUserId: null }), [paid('none', 12, { platformUserId: null })])).toBeNull();
  });

  it('names the earliest when several came in a row', () => {
    const third = paid('PAY-20932', 16);
    expect(duplicateOf(third, [first, second, third])).toBe('PAY-20930');
  });
});

describe('countByStatus', () => {
  it('names every status, 0 for one no payment has', () => {
    expect(
      countByStatus([
        { status: PaymentStatus.SUCCESS, _count: 1912 },
        { status: PaymentStatus.FAILED, _count: 38 },
      ]),
    ).toEqual({ PENDING: 0, SUCCESS: 1912, FAILED: 38, REFUNDED: 0 });
  });

  it('is all zeros when nothing matched', () => {
    expect(countByStatus([])).toEqual({ PENDING: 0, SUCCESS: 0, FAILED: 0, REFUNDED: 0 });
  });
});

describe('paymentIdPrefix', () => {
  it('reads the id as the app prints it, with or without PAY-', () => {
    expect(paymentIdPrefix('PAY-3F2A1C9B')).toBe('3f2a1c9b');
    expect(paymentIdPrefix(' pay-3f2a ')).toBe('3f2a');
    expect(paymentIdPrefix('3F2A1C9B')).toBe('3f2a1c9b');
  });

  it('has nothing to match when only PAY- was typed', () => {
    expect(paymentIdPrefix('PAY-')).toBeNull();
    expect(paymentIdPrefix('  ')).toBeNull();
  });
});
