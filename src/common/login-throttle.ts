import type { ThrottlerGetTrackerFunction } from '@nestjs/throttler';
import { toBdMobile } from '../sms/sms-text.js';

const FIFTEEN_MINUTES = 15 * 60 * 1000;

// The address and the account an attempt names: "default" counts per pair.
// A group login can be named by its phone number too, written many ways
// (017..., +880..., with spaces or dashes); each spelling of one number
// counts in one bucket, so they can't buy extra guesses.
export const accountTracker: ThrottlerGetTrackerFunction = (req) => {
  const raw = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 254) : '';
  const mobile = raw && !raw.includes('@') ? toBdMobile(raw) : null;
  return `${req.ip}|${mobile ? `phone:${mobile}` : raw}`;
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

// The second step of a sign-in names no email: its account is the challenge
// token's subject. Read without checking the signature -- it only picks the
// bucket; the token is verified, and its own tries counted, by the service.
export const challengeTracker: ThrottlerGetTrackerFunction = (req) => {
  const token = req.body?.challengeToken ?? req.body?.setupToken;
  let subject = '';
  if (typeof token === 'string') {
    try {
      const claims = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { sub?: unknown };
      if (typeof claims.sub === 'string') subject = claims.sub.slice(0, 64);
    } catch {
      // Not a JWT: the IP's own bucket.
    }
  }
  return `${req.ip}|${subject}`;
};

// The same budget as the password step, per IP and account.
export const TWO_STEP_THROTTLE = {
  default: { limit: 5, ttl: FIFTEEN_MINUTES, getTracker: challengeTracker },
  perIp: { limit: 30, ttl: FIFTEEN_MINUTES },
};
