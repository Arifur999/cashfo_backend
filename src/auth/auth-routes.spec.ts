import { isExposedAuthUrl } from './auth-routes.js';

describe('isExposedAuthUrl', () => {
  it.each([
    '/api/auth/sign-in/social',
    '/api/auth/callback/google?code=abc&state=xyz',
    '/api/auth/get-session',
    '/api/auth/sign-out',
  ])('exposes %s', (url) => {
    expect(isExposedAuthUrl(url, false)).toBe(true);
  });

  it.each(['/api/auth/dash/list-users', '/api/auth/events/types'])('exposes the dashboard route %s only while the dashboard key is set', (url) => {
    expect(isExposedAuthUrl(url, true)).toBe(true);
    expect(isExposedAuthUrl(url, false)).toBe(false);
  });

  it.each([
    // Served by the app's own controllers.
    '/api/auth/login',
    '/api/auth/register',
    '/api/auth/reset-password',
    // better-auth endpoints the app keeps closed.
    '/api/auth/sign-up/email',
    '/api/auth/sign-in/email',
    '/api/auth/update-user',
    '/api/auth/change-password',
    '/api/auth/list-sessions',
    '/api/auth/callback/',
    '/api/auth/dash',
    '/admin/auth/login',
  ])('keeps %s closed', (url) => {
    expect(isExposedAuthUrl(url, true)).toBe(false);
  });

  it.each(['/api/auth/callback/../sign-up/email', '/api/auth/callback/%2e%2e/sign-up/email', '/api/auth/dash/%2E%2E/update-user'])(
    'is not fooled by dot segments: %s',
    (url) => {
      expect(isExposedAuthUrl(url, true)).toBe(false);
    },
  );
});
