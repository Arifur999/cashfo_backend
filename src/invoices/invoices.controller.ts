import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard.js';
import { RolesGuard } from '../admin-auth/guards/roles.guard.js';
import { ListInvoicesQueryDto } from './dto/list-invoices-query.dto.js';
import { InvoicesService } from './invoices.service.js';

// Any admin may read invoices, like payments; RolesGuard is in place so a
// @Roles() on a future write route is enforced rather than ignored.
@UseGuards(AdminAuthGuard, RolesGuard)
@Controller('admin/invoices')
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Get()
  list(@Query() query: ListInvoicesQueryDto) {
    return this.invoicesService.list(query);
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.invoicesService.getById(id);
  }
}
