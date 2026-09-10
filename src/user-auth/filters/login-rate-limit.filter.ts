import { ArgumentsHost, Catch, ExceptionFilter, Injectable } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service.js';

// Same purpose as admin-auth's LoginRateLimitFilter: ThrottlerGuard rejects a
// rate-limited login before UserAuthService.login() ever runs, so without
// this filter a "rate_limited" LoginAttempt row would never get written.
@Injectable()
@Catch(ThrottlerException)
export class LoginRateLimitFilter implements ExceptionFilter {
  constructor(private readonly prisma: PrismaService) {}

  async catch(exception: ThrottlerException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const email = typeof request.body?.email === 'string' ? request.body.email : 'unknown';
    await this.prisma.loginAttempt.create({
      data: {
        email,
        ipAddress: request.ip ?? 'unknown',
        userAgent: request.headers['user-agent'],
        success: false,
        failureReason: 'rate_limited',
      },
    });

    response.status(exception.getStatus()).json(exception.getResponse());
  }
}
