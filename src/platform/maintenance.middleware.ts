import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { SettingsService } from '../settings/settings.service.js';

// What stays reachable while maintenance mode is on: how the customer app
// finds out (platform), health checks, and signing in, out and refreshing --
// /api/auth/sign-in is the admins' sign-in too, and the admin panel (all of
// /admin/*) must keep working so maintenance can be switched off again.
const OPEN_DURING_MAINTENANCE = [
  '/api/platform',
  '/api/health',
  '/api/auth/sign-in',
  '/api/auth/session/sign-in',
  '/api/auth/login',
  '/api/auth/session/exchange',
  '/api/auth/refresh',
  '/api/auth/logout',
];

// Maintenance mode (Settings > General) closes the customer API: every other
// /api/* request gets a 503 carrying the admin's message, which the customer
// app shows instead of its pages. Answered here rather than thrown from a
// guard so the exception filter doesn't log each refused request as an
// incident, and before the throttler counts it.
@Injectable()
export class MaintenanceMiddleware implements NestMiddleware {
  constructor(private readonly settingsService: SettingsService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const path = req.originalUrl.split('?')[0];
    if (!path.startsWith('/api/') || OPEN_DURING_MAINTENANCE.some((open) => path === open || path.startsWith(`${open}/`))) {
      return next();
    }

    let settings;
    try {
      settings = await this.settingsService.getCached();
    } catch {
      // Can't read the switch: let the request through rather than take the
      // whole customer API down over it.
      return next();
    }
    if (!settings.maintenanceMode) {
      return next();
    }

    res.setHeader('Retry-After', '300');
    res.status(503).json({ statusCode: 503, error: 'Service Unavailable', message: settings.maintenanceMessage, maintenance: true });
  }
}
