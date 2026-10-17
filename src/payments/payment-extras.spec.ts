import { PaymentStatus } from '@prisma/client';
import { duplicateOf } from './payment-extras.js';

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 1, 4, minutes));
const paid = (id: string, minutes: number, overrides: Partial<{ platformUserId: string; planId: string; status: PaymentStatus }> = {}) => ({
  id,
  platformUserId: 'mahbub',
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

  it('names the earliest when several came in a row', () => {
    const third = paid('PAY-20932', 16);
    expect(duplicateOf(third, [first, second, third])).toBe('PAY-20930');
  });
});
