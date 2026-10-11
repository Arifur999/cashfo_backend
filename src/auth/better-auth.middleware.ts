import { toNodeHandler } from 'better-auth/node';
import type { RequestHandler } from 'express';
import { isExposedAuthUrl } from './auth-routes.js';
import type { Auth } from './better-auth.js';

// Hands the exposed better-auth endpoints (see auth-routes.ts) to
// better-auth and lets every other request fall through to Nest. Registered
// before Nest's body parser, because better-auth reads the raw body itself.
export const betterAuthMiddleware = (auth: Auth): RequestHandler => {
  const handler = toNodeHandler(auth);

  return (req, res, next) => {
    if (!isExposedAuthUrl(req.originalUrl)) return next();

    // better-auth takes the client address from X-Forwarded-For. Give it
    // the one Express already resolved under TRUST_PROXY, as a single
    // value, so sessions and the dashboard see the same IP as the app.
    if (req.ip) req.headers['x-forwarded-for'] = req.ip;
    handler(req, res).catch(next);
  };
};
