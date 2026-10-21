import { PaymentStatus } from '@prisma/client';

export interface DuplicateCandidate {
  id: string;
  platformUserId: string;
  planId: string;
  status: PaymentStatus;
  createdAt: Date;
}

// Two successful payments by the same person for the same plan this close
// together look like a double charge.
export const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

// The earlier successful payment this one repeats, if any: same person,
// same plan, within the window before it. The first of the pair is the
// real one, so it never points at the later one.
export function duplicateOf(payment: DuplicateCandidate, candidates: DuplicateCandidate[]): string | null {
  if (payment.status !== PaymentStatus.SUCCESS && payment.status !== PaymentStatus.REFUNDED) return null;
  let earlier: DuplicateCandidate | null = null;
  for (const other of candidates) {
    if (other.id === payment.id || other.platformUserId !== payment.platformUserId || other.planId !== payment.planId) continue;
    if (other.status !== PaymentStatus.SUCCESS && other.status !== PaymentStatus.REFUNDED) continue;
    const gap = payment.createdAt.getTime() - other.createdAt.getTime();
    if (gap <= 0 || gap > DUPLICATE_WINDOW_MS) continue;
    if (!earlier || other.createdAt < earlier.createdAt) earlier = other;
  }
  return earlier?.id ?? null;
}

// The start of a payment's id from what an admin typed: the app prints
// ids as "PAY-" and the first 8 characters, upper case ("PAY-3F2A1C9B"),
// and stored ids are lower case. Null when nothing is left to match.
export function paymentIdPrefix(search: string): string | null {
  const prefix = search.trim().replace(/^pay-/i, '').toLowerCase();
  return prefix.length > 0 ? prefix : null;
}
