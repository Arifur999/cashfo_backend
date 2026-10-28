import type { ThrottlerLimitDetail } from '@nestjs/throttler';

export { firstWithin as shouldLogBlock } from '../analytics/usage-events.js';

export interface ThrottledRequest {
  method: string;
  path: string;
  route?: { path?: unknown };
  ip?: string;
  user?: { id?: string };
  adminUser?: { id?: string };
}

// Path segments that are ids, for a request no route matched by pattern.
const ID_SEGMENT = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+)$/i;

// "GET /api/businesses/:businessId/transactions": the route's pattern, not
// the URL, so one endpoint is one row whichever workspace or record was
// asked for (and no ids or query strings land in the log).
export function rateLimitEndpoint(req: Pick<ThrottledRequest, 'method' | 'path' | 'route'>): string {
  const pattern =
    typeof req.route?.path === 'string'
      ? req.route.path
      : req.path
          .split('/')
          .map((segment) => (ID_SEGMENT.test(segment) ? ':id' : segment))
          .join('/');
  return `${req.method} ${pattern}`.slice(0, 300);
}

// Who was refused: the signed-in admin or customer when a guard has already
// put them on the request, otherwise the address. The throttler runs as the
// app-wide guard, before the routes' own guards, so in practice that is
// nearly always the address.
export function rateLimitIdentity(req: Pick<ThrottledRequest, 'ip' | 'user' | 'adminUser'>): { identifierType: 'admin' | 'user' | 'ip'; identifier: string } {
  if (req.adminUser?.id) return { identifierType: 'admin', identifier: req.adminUser.id };
  if (req.user?.id) return { identifierType: 'user', identifier: req.user.id };
  return { identifierType: 'ip', identifier: req.ip ?? 'unknown' };
}

// The ApiRateLimitLog row for one refused request. The window began ttl
// before it ends (timeToExpire is in seconds); requestCount is the hits the
// throttler had counted in it, the refused one included.
export function rateLimitEntry(req: ThrottledRequest, detail: Pick<ThrottlerLimitDetail, 'ttl' | 'timeToExpire' | 'totalHits'>, now: number) {
  const elapsed = Math.min(Math.max(detail.ttl - detail.timeToExpire * 1000, 0), detail.ttl);
  return {
    endpoint: rateLimitEndpoint(req),
    windowStart: new Date(now - elapsed),
    requestCount: detail.totalHits,
    limitExceeded: true,
    ...rateLimitIdentity(req),
  };
}
