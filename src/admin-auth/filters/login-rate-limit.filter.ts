import { ArgumentsHost, Catch, ExceptionFilter, Injectable } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service.js';

// The login routes' throttle window.
const WINDOW_MS = 15 * 60 * 1000;

// ThrottlerGuard rejects a rate-limited login before AdminAuthService.login()
// ever runs, so without this filter a "rate_limited" LoginAttempt row would
// never get written -- this catches the throttler's exception on the login
// route specifically, logs the attempt, then re-sends the same 429 response.
// One "rate_limited" row per IP per window is enough to show the block in
// Login Monitoring; writing one for every refused request let a flood of
// them grow the table without limit.
@Injectable()
@Catch(ThrottlerException)
export class LoginRateLimitFilter implements ExceptionFilter {
  constructor(private readonly prisma: PrismaService) {}

  async catch(exception: ThrottlerException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const email = typeof request.body?.email === 'string' ? request.body.email.slice(0, 254) : 'unknown';
    const ipAddress = request.ip ?? 'unknown';
    const alreadyRecorded = await this.prisma.loginAttempt.count({
      where: { ipAddress, failureReason: 'rate_limited', createdAt: { gt: new Date(Date.now() - WINDOW_MS) } },
    });
    if (alreadyRecorded === 0) {
      await this.prisma.loginAttempt.create({
        data: { email, ipAddress, userAgent: request.headers['user-agent'], success: false, failureReason: 'rate_limited' },
      });
    }

    response.status(exception.getStatus()).json(exception.getResponse());
  }
}
