import type { Role, UserStatus } from '@prisma/client';

// The login throttle's window (common/login-throttle.ts): a pause lasts this
// long from the first refused try.
export const PAUSE_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// How long after a failed try a successful one still counts as "then signed in".
export const SIGNED_IN_AFTER_MS = DAY_MS;

export interface KnownAccount {
  email: string;
  name: string;
  role: Role;
  status: UserStatus;
}

// Emails are stored lowercase on accounts; an attempt keeps what was typed.
export const normalizeEmail = (email: string) => email.trim().toLowerCase();

// The sentence a "many failed sign-ins" flag carries: how many, from where,
// and whose account they went for.
export function failedSignInsDescription(ipAddress: string, count: number, emails: string[], accounts: Map<string, KnownAccount>): string {
  const head = `${count} failed sign-ins from ${ipAddress} within 15 minutes.`;
  if (emails.length === 0) return head;
  if (emails.length > 1) return `${head} They tried ${emails.length} different accounts.`;
  const [email] = emails;
  const account = accounts.get(email);
  const whose = !account ? 'which has no account here' : account.role === 'USER' ? "an app user's account" : 'an admin account';
  return `${head} They tried ${email}, ${whose}.`;
}

export interface RefusedTry {
  email: string;
  ipAddress: string;
  createdAt: Date;
}

// Networks sign-in is refusing right now. The rate-limit filter writes one
// "rate_limited" row per network at the first refused try, and the pause
// runs for the throttle window from then. Newest first.
export function pausedNetworks(refused: RefusedTry[], now: number): Array<{ ipAddress: string; email: string; until: Date }> {
  const latestByIp = new Map<string, RefusedTry>();
  for (const attempt of refused) {
    const seen = latestByIp.get(attempt.ipAddress);
    if (!seen || attempt.createdAt > seen.createdAt) latestByIp.set(attempt.ipAddress, attempt);
  }
  return [...latestByIp.values()]
    .map((attempt) => ({ ipAddress: attempt.ipAddress, email: attempt.email, until: new Date(attempt.createdAt.getTime() + PAUSE_MS) }))
    .filter((pause) => pause.until.getTime() > now)
    .sort((a, b) => b.until.getTime() - a.until.getTime());
}

// When the same email next signed in after a failed try, within a day.
// `successes` must be oldest first.
export function signedInAfter(failed: { email: string; createdAt: Date }, successes: Array<{ email: string; createdAt: Date }>): Date | null {
  const email = normalizeEmail(failed.email);
  const from = failed.createdAt.getTime();
  const match = successes.find(
    (success) => normalizeEmail(success.email) === email && success.createdAt.getTime() > from && success.createdAt.getTime() - from <= SIGNED_IN_AFTER_MS,
  );
  return match?.createdAt ?? null;
}

export interface PlacedSignIn {
  // ISO country code and name (common/ip-country.ts ipCountry).
  code: string;
  name: string;
  ipAddress: string;
  createdAt: Date;
}

// The sign-ins (oldest first) that came from a country the account had
// never signed in from before. `earlier` holds the countries (code -> name)
// of the account's earlier sign-ins that could be placed. With none, there
// is nothing to compare against: the first placed sign-in only becomes the
// baseline. A new country is reported once, then counts as known.
export function signInsFromNewCountries(earlier: Map<string, string>, signIns: PlacedSignIn[]): Array<{ signIn: PlacedSignIn; earlierCountries: string[] }> {
  const known = new Map(earlier);
  const found: Array<{ signIn: PlacedSignIn; earlierCountries: string[] }> = [];
  for (const signIn of signIns) {
    if (known.size > 0 && !known.has(signIn.code)) found.push({ signIn, earlierCountries: [...known.values()] });
    known.set(signIn.code, signIn.name);
  }
  return found;
}

// The sentence an "unusual sign-in location" flag carries.
export function unusualLocationDescription(name: string, email: string, country: string, earlierCountries: string[]): string {
  return `${name} (${email}) signed in from ${country}, a country this account has never signed in from before. Earlier sign-ins: ${earlierCountries.join(', ')}.`;
}

// One flag per account and country, however often the check runs.
export const locationDedupeKey = (userId: string, countryCode: string) => `location:${userId}:${countryCode}`;
