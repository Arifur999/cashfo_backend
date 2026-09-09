import { ArgumentsHost, Catch, HttpException, Injectable } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Request } from 'express';
import { ErrorLogsService } from '../error-logs.service.js';

// Global "bonus" wiring from the Prompt 9 spec: logs unhandled server errors
// to ErrorLog without changing any response behavior. Extending
// BaseExceptionFilter and delegating to super.catch() (Nest's documented
// pattern for this) means every existing response shape -- validation
// errors, 401s, 403s, 404s, 429s -- is untouched; this filter only adds a
// side effect for genuine 5xx failures.
@Injectable()
@Catch()
export class GlobalExceptionFilter extends BaseExceptionFilter {
  constructor(private readonly errorLogsService: ErrorLogsService) {
    super();
  }

  async catch(exception: unknown, host: ArgumentsHost) {
    const status = exception instanceof HttpException ? exception.getStatus() : 500;

    // Only genuine server-side failures are incidents worth logging --
    // expected 4xx responses (validation errors, auth failures, throttling)
    // are normal traffic, not something an on-call admin needs surfaced here.
    if (status >= 500) {
      const request = host.switchToHttp().getRequest<Request>();
      try {
        await this.errorLogsService.report({
          source: 'BACKEND_API',
          message: exception instanceof Error ? exception.message : 'Unknown error',
          stackTrace: exception instanceof Error ? exception.stack : undefined,
          severity: 'HIGH',
          metadata: { path: request.url, method: request.method },
        });
      } catch {
        // Never let error-logging itself block the real error response.
      }
    }

    super.catch(exception, host);
  }
}
