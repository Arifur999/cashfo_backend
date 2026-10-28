import type { Prisma } from '@prisma/client';

// Payment.failureReason for a checkout that closed without anything going
// wrong: the customer opened a new one or cancelled it, or it lapsed.
export const CLOSED_CHECKOUT_REASONS = ['replaced', 'cancelled_by_user', 'expired'];

// FAILED payments worth an admin's eye: not the closed checkouts above.
export const REAL_FAILURE_WHERE = {
  OR: [{ failureReason: null }, { failureReason: { notIn: CLOSED_CHECKOUT_REASONS } }],
} satisfies Prisma.PaymentWhereInput;
