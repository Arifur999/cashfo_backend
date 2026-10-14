import { ArgumentsHost, BadRequestException, Catch, ConflictException, HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { ErrorLogsService } from '../error-logs.service.js';

// Global "bonus" wiring from the Prompt 9 spec: logs unhandled server errors
// to ErrorLog. Extending BaseExceptionFilter and delegating to super.catch()
// (Nest's documented pattern for this) keeps every existing response shape
// -- validation errors, 401s, 403s, 404s, 429s -- untouched; this filter only
// adds a side effect for genuine 5xx failures, and turns the database errors
// a client's input causes into the 4xx they are (below).
@Injectable()
@Catch()
export class GlobalExceptionFilter extends BaseExceptionFilter {
  private readonly logger = new Logger('ClientError');

  constructor(private readonly errorLogsService: ErrorLogsService) {
    super();
  }

  async catch(exception: unknown, host: ArgumentsHost) {
    const clientError = toClientError(exception);
    const response = clientError ?? exception;
    const status = statusOf(response);

    // A database error answered as a 4xx is usually the client's doing, but
    // can be a query the code built wrongly -- keep a line in the server
    // log (not an ErrorLog incident) so that stays findable.
    if (clientError) {
      const request = host.switchToHttp().getRequest<Request>();
      this.logger.warn(
        `${request.method} ${request.path} -> ${status}: ${exception instanceof Error ? exception.message.split('\n').filter(Boolean).at(-1) : 'unknown'}`,
      );
    }

    // Only genuine server-side failures are incidents worth logging --
    // expected 4xx responses (validation errors, auth failures, throttling,
    // a body too large) are normal traffic, not something an on-call admin
    // needs surfaced here.
    if (status >= 500) {
      const request = host.switchToHttp().getRequest<Request>();
      try {
        await this.errorLogsService.report({
          source: 'BACKEND_API',
          message: exception instanceof Error ? exception.message : 'Unknown error',
          stackTrace: exception instanceof Error ? exception.stack : undefined,
          severity: 'HIGH',
          // The path without its query string, which can carry codes and
          // tokens (an OAuth callback's ?code=...).
          metadata: { path: request.path, method: request.method },
        });
      } catch {
        // Never let error-logging itself block the real error response.
      }
    }

    super.catch(response, host);
  }
}

const INVALID_VALUE = 'One of the values sent is not valid';

// Database errors that mean the request was wrong, not the server: a
// duplicate, a missing linked row, a value the column can't hold, an
// argument Prisma rejects (an invalid date, a null for a required field).
// Left alone they answered 500 and filled the error log. The messages are
// generic -- Prisma's own name tables and columns.
export function toClientError(exception: unknown): HttpException | undefined {
  if (exception instanceof Prisma.PrismaClientValidationError) {
    return new BadRequestException(INVALID_VALUE);
  }
  if (exception instanceof Prisma.PrismaClientKnownRequestError) {
    switch (exception.code) {
      case 'P2002':
        return new ConflictException('This already exists');
      case 'P2025':
        return new NotFoundException('Not found');
      case 'P2003':
        return new BadRequestException('Something this refers to does not exist');
      case 'P2000': // value too long for the column
      case 'P2007': // data validation error
      case 'P2011': // null in a required column
      case 'P2019': // input error
      case 'P2020': // value out of range for the type
      case 'P2023': // inconsistent column data
      case 'P2033': // number doesn't fit in 64 bits
        return new BadRequestException(INVALID_VALUE);
    }
  }
  return undefined;
}

// An HttpException's status, or the status of an http-errors error such as
// body-parser's 413 "request entity too large" (Nest answers those with
// their own status too), else 500.
function statusOf(exception: unknown): number {
  if (exception instanceof HttpException) return exception.getStatus();
  const status = (exception as { statusCode?: unknown } | null)?.statusCode;
  return typeof status === 'number' && status >= 400 && status < 600 ? status : 500;
}
