import { Controller, Get, Header, HttpCode, Param, Post, Query, Req, StreamableFile, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator.js';
import { Roles } from '../admin-auth/decorators/roles.decorator.js';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard.js';
import { RolesGuard } from '../admin-auth/guards/roles.guard.js';
import type { RequestAdminUser } from '../admin-auth/interfaces/request-admin-user.interface.js';
import { AdminRole } from '../common/roles.js';
import { ListInvoicesQueryDto } from './dto/list-invoices-query.dto.js';
import { InvoicePdfService } from './invoice-pdf.service.js';
import { InvoicesService } from './invoices.service.js';

// Any admin may read invoices, like payments; RolesGuard is in place so a
// @Roles() on a future write route is enforced rather than ignored.
@UseGuards(AdminAuthGuard, RolesGuard)
@Controller('admin/invoices')
export class InvoicesController {
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly invoicePdf: InvoicePdfService,
  ) {}

  @Get()
  list(@Query() query: ListInvoicesQueryDto) {
    return this.invoicesService.list(query);
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.invoicesService.getById(id);
  }

  // Made on demand; nothing is stored (pdfUrl stays null).
  @Get(':id/pdf')
  @Header('Cache-Control', 'private, no-store')
  async pdf(@Param('id') id: string) {
    const pdf = await this.invoicePdf.render(id);
    return new StreamableFile(pdf.data, { type: 'application/pdf', disposition: `attachment; filename="${pdf.fileName}"` });
  }

  // Sends the invoice, PDF attached, to the customer who paid.
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.FINANCE_ADMIN)
  @Post(':id/email')
  @HttpCode(200)
  email(@Param('id') id: string, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.invoicesService.email(id, admin.id, req.ip);
  }
}
