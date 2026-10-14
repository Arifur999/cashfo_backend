import type { ThrottlerGetTrackerFunction } from '@nestjs/throttler';

const FIFTEEN_MINUTES = 15 * 60 * 1000;

// The address and the account an attempt names: "default" counts per pair.
export const accountTracker: ThrottlerGetTrackerFunction = (req) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 254) : '';
  return `${req.ip}|${email}`;
};

// Password sign-in: 5 attempts per 15 minutes for each IP and account, and
// 30 per IP across all accounts. Counting per IP alone let one person lock
// out everyone sharing their address -- a mobile carrier's NAT puts many
// customers behind one -- with five bad tries, and refused the sixth honest
// sign-in in an office. Per account, a guesser still gets five tries.
export const LOGIN_THROTTLE = {
  default: { limit: 5, ttl: FIFTEEN_MINUTES, getTracker: accountTracker },
  perIp: { limit: 30, ttl: FIFTEEN_MINUTES },
};
