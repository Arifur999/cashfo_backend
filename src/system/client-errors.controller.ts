import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import { UserAuthGuard } from '../user-auth/guards/user-auth.guard.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { ReportClientErrorDto } from './dto/report-client-error.dto.js';
import { ErrorLogsService } from './error-logs.service.js';

// The customer app's error screen logging the crash it shows, so the
// reference it asks the customer to quote to support has a row in System >
// Error Logs. The admin panel reports to POST /admin/system/errors instead.
// (A super admin's read-only "View as customer" session is refused here by
// UserAuthGuard, like every other write.)
@UseGuards(UserAuthGuard)
@Controller('api/client-errors')
export class ClientErrorsController {
  constructor(private readonly errorLogsService: ErrorLogsService) {}

  // One error screen sends one report; 10 a minute per address is room for
  // a few retries and keeps a page stuck re-rendering from filling the log.
  @Throttle({ default: { limit: 10, ttl: 60 * 1000 } })
  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  async report(@CurrentUser() user: RequestUser, @Body() dto: ReportClientErrorDto, @Req() req: Request): Promise<void> {
    // req.ip already honours TRUST_PROXY; the frontend forwards the
    // visitor's X-Forwarded-For and User-Agent with every call.
    await this.errorLogsService.reportCustomerError(user.id, dto, { ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  }
}
