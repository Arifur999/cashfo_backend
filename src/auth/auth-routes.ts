import { AUTH_BASE_PATH } from './better-auth.js';

// The better-auth endpoints reachable over HTTP. Everything else under
// /api/auth -- email sign-up and sign-in, password and profile changes --
// stays with the app's own UserAuthController, which adds the login
// throttle, login history, workspace provisioning and the app's tokens.
const EXPOSED_ENDPOINTS = new Set(['/sign-in/social', '/get-session', '/sign-out', '/ok', '/error']);
// OAuth callbacks (/callback/google).
const EXPOSED_PREFIXES = ['/callback/'];
// The Better Auth Infra dashboard's endpoints (user, session and password
// administration, impersonation) -- reachable only while BETTER_AUTH_API_KEY
// is set, i.e. while the dashboard is actually in use. Without the key the
// plugin isn't loaded either.
const DASHBOARD_PREFIXES = ['/dash/', '/events/'];

// Matches on the path as better-auth will see it: WHATWG URL parsing folds
// "..", "%2e%2e" and friends, so /api/auth/callback/../sign-up/email is
// judged as the /sign-up/email it really is.
export const isExposedAuthUrl = (url: string, dashboardEnabled = Boolean(process.env.BETTER_AUTH_API_KEY)): boolean => {
  const { pathname } = new URL(url, 'http://localhost');
  if (!pathname.startsWith(`${AUTH_BASE_PATH}/`)) return false;

  const endpoint = pathname.slice(AUTH_BASE_PATH.length);
  const prefixes = dashboardEnabled ? [...EXPOSED_PREFIXES, ...DASHBOARD_PREFIXES] : EXPOSED_PREFIXES;
  return EXPOSED_ENDPOINTS.has(endpoint) || prefixes.some((prefix) => endpoint.startsWith(prefix) && endpoint.length > prefix.length);
};
