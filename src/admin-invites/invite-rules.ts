import type { Role } from '@prisma/client';

// The pure rules of admin invites and admin password resets, apart from the
// database so the specs can pin them down.

// The link in an invite works once, for seven days.
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// A super admin can send the same invite again after a minute.
export const INVITE_RESEND_AFTER_MS = 60 * 1000;
// The emailed admin reset link works once, for thirty minutes.
export const ADMIN_RESET_TTL_MS = 30 * 60 * 1000;

export type InviteState = 'PENDING' | 'EXPIRED' | 'ACCEPTED' | 'REVOKED';

export function inviteState(invite: { expiresAt: Date; acceptedAt: Date | null; revokedAt: Date | null }, now: Date): InviteState {
  if (invite.acceptedAt) return 'ACCEPTED';
  if (invite.revokedAt) return 'REVOKED';
  if (invite.expiresAt <= now) return 'EXPIRED';
  return 'PENDING';
}

// Seconds until the invite can be sent again; 0 when it can be now.
export function resendWaitSec(lastSentAt: Date, now: Date): number {
  return Math.max(0, Math.ceil((lastSentAt.getTime() + INVITE_RESEND_AFTER_MS - now.getTime()) / 1000));
}

// Whether a reset token can still be used: unused, unexpired, and its owner
// an active admin (a customer's token never works on the admin page).
export function adminResetUsable(
  token: { usedAt: Date | null; expiresAt: Date } | null,
  owner: { status: string; isAdmin: boolean } | null,
  now: Date,
): boolean {
  return Boolean(token && !token.usedAt && token.expiresAt > now && owner?.status === 'ACTIVE' && owner.isAdmin);
}

// How the invite email and the accept page name the role.
export const ROLE_LABELS: Record<Exclude<Role, 'USER'>, { en: string; bn: string }> = {
  SUPER_ADMIN: { en: 'Super admin', bn: 'সুপার অ্যাডমিন' },
  SUPPORT_ADMIN: { en: 'Support admin', bn: 'সাপোর্ট অ্যাডমিন' },
  FINANCE_ADMIN: { en: 'Finance admin', bn: 'ফাইন্যান্স অ্যাডমিন' },
  CONTENT_ADMIN: { en: 'Content admin', bn: 'কনটেন্ট অ্যাডমিন' },
};
