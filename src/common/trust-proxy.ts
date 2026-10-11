// Express's "trust proxy" setting, read from TRUST_PROXY.
//
// Nothing reaches this API straight from a browser: both frontends call it
// server-side, and production adds nginx in front. Without trusting those
// hops, req.ip is the calling server's address for every request -- one
// shared login-throttle bucket for all admins, and Login Monitoring / the
// audit log full of the same IP. Trusting them makes req.ip the right-most
// address in X-Forwarded-For that isn't a trusted proxy: the real client,
// as appended by the proxy that saw it.
//
// Only list hops you control. The default, "loopback", trusts proxies on
// this machine (a frontend server or nginx calling via localhost).
export const DEFAULT_TRUST_PROXY = 'loopback';

export type TrustProxySetting = boolean | number | string;

// "false" / "true", a hop count ("1"), or anything Express itself accepts
// as a string: "loopback", "uniquelocal", an IP, a CIDR, or a comma list.
export function parseTrustProxy(value: string | undefined): TrustProxySetting {
  const trimmed = value?.trim();
  if (!trimmed) return DEFAULT_TRUST_PROXY;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}
