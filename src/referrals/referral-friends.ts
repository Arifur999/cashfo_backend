import type { CommissionStatus, Prisma } from '@prisma/client';
import { BLOCKED_SIGNUP_REASONS, type FriendStanding } from './referral-rules.js';

// Commission statuses that count as earned (not taken back or never earned).
export const EARNED_STATUSES = ['ON_HOLD', 'AVAILABLE', 'IN_WITHDRAWAL', 'UNDER_CHECK', 'PAID_OUT'] as const satisfies readonly CommissionStatus[];

// A paid plan that is running (a trial is not paid), as isPaidStatus() reads it.
const PAID_SUBSCRIPTION: Prisma.UserSubscriptionWhereInput = { status: { in: ['ACTIVE', 'PAST_DUE'] }, plan: { billingCycle: { not: 'FREE' } } };

const blocked: Prisma.ReferralWhereInput = { status: 'CANCELLED', cancelReason: { in: [...BLOCKED_SIGNUP_REASONS] } };
const counted: Prisma.ReferralWhereInput = { NOT: blocked };
const notPaying: Prisma.ReferralWhereInput = { referredUser: { NOT: { subscription: { is: PAID_SUBSCRIPTION } } } };

export const payingFriendWhere = (): Prisma.ReferralWhereInput => ({ AND: [counted, { referredUser: { subscription: { is: PAID_SUBSCRIPTION } } }] });

// The tabs of Referrals > Referred users: one standing, or ENDED for
// "Stopped or refunded".
export type FriendFilter = FriendStanding | 'ENDED';
export const FRIEND_FILTERS: FriendFilter[] = ['PAYING', 'FREE', 'STOPPED', 'REFUNDED', 'BLOCKED', 'ENDED'];

// The friends in one standing, as friendStanding() decides it for a row.
export function standingWhere(standing: FriendFilter): Prisma.ReferralWhereInput {
  switch (standing) {
    case 'ENDED':
      return { OR: [standingWhere('STOPPED'), standingWhere('REFUNDED')] };
    case 'BLOCKED':
      return blocked;
    case 'PAYING':
      return payingFriendWhere();
    case 'STOPPED':
      return { AND: [counted, notPaying, { referredUser: { payments: { some: { status: 'SUCCESS' } } } }] };
    case 'REFUNDED':
      return { AND: [counted, notPaying, { referredUser: { payments: { none: { status: 'SUCCESS' }, some: { status: 'REFUNDED' } } } }] };
    case 'FREE':
      return { AND: [counted, notPaying, { referredUser: { payments: { none: { status: { in: ['SUCCESS', 'REFUNDED'] } } } } }] };
  }
}

export const FRIEND_STANDINGS: FriendStanding[] = ['PAYING', 'FREE', 'STOPPED', 'REFUNDED', 'BLOCKED'];
