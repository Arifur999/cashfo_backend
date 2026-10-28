import { Body, Controller, Get, Header, HttpCode, Param, Post, Query, Req, Res, StreamableFile, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AdminRole } from '../common/roles.js';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator.js';
import { Roles } from '../admin-auth/decorators/roles.decorator.js';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard.js';
import { RolesGuard } from '../admin-auth/guards/roles.guard.js';
import type { RequestAdminUser } from '../admin-auth/interfaces/request-admin-user.interface.js';
import { ListPaymentsQueryDto } from './dto/list-payments-query.dto.js';
import { MarkFailedDto, MarkPaidDto } from './dto/mark-paid.dto.js';
import { RefundPaymentDto } from './dto/refund-payment.dto.js';
import { PaymentsService } from './payments.service.js';

@UseGuards(AdminAuthGuard, RolesGuard)
@Controller('admin/payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get()
  list(@Query() query: ListPaymentsQueryDto) {
    return this.paymentsService.list(query);
  }

  @Get('failed')
  failed(@Query() query: ListPaymentsQueryDto) {
    return this.paymentsService.failed(query);
  }

  @Get('stats')
  stats() {
    return this.paymentsService.stats();
  }

  // Every row the list's filters match, as a spreadsheet. Before ':id', so
  // "export" is not read as a payment id. X-Export-Rows says how many rows
  // it holds and X-Export-Truncated whether the row cap cut it short.
  @Throttle({ default: { limit: 10, ttl: 60 * 1000 } })
  @Get('export')
  @Header('Cache-Control', 'private, no-store')
  async export(@Query() query: ListPaymentsQueryDto, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const file = await this.paymentsService.exportCsv(query, admin.id, req.ip);
    res.setHeader('X-Export-Rows', String(file.rows));
    res.setHeader('X-Export-Truncated', file.truncated ? 'true' : 'false');
    return new StreamableFile(file.data, { type: 'text/csv; charset=utf-8', disposition: `attachment; filename="${file.fileName}"` });
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.paymentsService.getById(id);
  }

  // A customer's checkout arrived: the plan starts, with an invoice.
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.FINANCE_ADMIN)
  @Post(':id/mark-paid')
  @HttpCode(200)
  markPaid(@Param('id') id: string, @Body() dto: MarkPaidDto, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.paymentsService.markPaid(id, dto, admin.id, req.ip);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.FINANCE_ADMIN)
  @Post(':id/mark-failed')
  @HttpCode(200)
  markFailed(@Param('id') id: string, @Body() dto: MarkFailedDto, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.paymentsService.markFailed(id, dto.reason, admin.id, req.ip);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.FINANCE_ADMIN)
  @Post(':id/retry')
  retry(@Param('id') id: string, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.paymentsService.retry(id, admin.id, req.ip);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.FINANCE_ADMIN)
  @Post(':id/refund')
  refund(@Param('id') id: string, @Body() dto: RefundPaymentDto, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.paymentsService.refund(id, dto, admin.id, req.ip);
  }
}
