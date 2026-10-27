import { rateLimitEndpoint, rateLimitEntry, rateLimitIdentity } from './rate-limit-log.js';

describe('rateLimitEndpoint', () => {
  it("uses the route's pattern", () => {
    expect(rateLimitEndpoint({ method: 'GET', path: '/api/businesses/6f1c/transactions', route: { path: '/api/businesses/:businessId/transactions' } })).toBe(
      'GET /api/businesses/:businessId/transactions',
    );
  });

  it('hides ids when no route matched', () => {
    expect(rateLimitEndpoint({ method: 'POST', path: '/api/things/0b8f7a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b/items/42' })).toBe('POST /api/things/:id/items/:id');
  });
});

describe('rateLimitIdentity', () => {
  it('prefers a signed-in admin or customer, else the address', () => {
    expect(rateLimitIdentity({ adminUser: { id: 'a1' }, ip: '1.2.3.4' })).toEqual({ identifierType: 'admin', identifier: 'a1' });
    expect(rateLimitIdentity({ user: { id: 'u1' }, ip: '1.2.3.4' })).toEqual({ identifierType: 'user', identifier: 'u1' });
    expect(rateLimitIdentity({ ip: '1.2.3.4' })).toEqual({ identifierType: 'ip', identifier: '1.2.3.4' });
    expect(rateLimitIdentity({})).toEqual({ identifierType: 'ip', identifier: 'unknown' });
  });
});

describe('rateLimitEntry', () => {
  it('dates the window from what is left of it', () => {
    const now = Date.UTC(2026, 9, 28, 10, 0, 0);
    const entry = rateLimitEntry(
      { method: 'POST', path: '/api/auth/sign-in', route: { path: '/api/auth/sign-in' }, ip: '198.51.100.77' },
      { ttl: 15 * 60 * 1000, timeToExpire: 10 * 60, totalHits: 6 },
      now,
    );
    expect(entry).toEqual({
      endpoint: 'POST /api/auth/sign-in',
      windowStart: new Date(now - 5 * 60 * 1000),
      requestCount: 6,
      limitExceeded: true,
      identifierType: 'ip',
      identifier: '198.51.100.77',
    });
  });
});
