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
