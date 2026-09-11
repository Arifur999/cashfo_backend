import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { MemberRole } from '@prisma/client';
import { ContactsService } from './contacts.service.js';
import { CreateContactDto } from './dto/create-contact.dto.js';
import { ListContactsQueryDto } from './dto/list-contacts-query.dto.js';
import { UpdateContactDto } from './dto/update-contact.dto.js';
import { RequireBusinessMembership } from '../business-access/decorators/require-business-membership.decorator.js';
import { RequireRole } from '../business-access/decorators/require-role.decorator.js';
import { ListTransactionsQueryDto } from '../transactions/dto/list-transactions-query.dto.js';
import { TransactionsService } from '../transactions/transactions.service.js';

// Viewing (list/detail/transactions) is open to all roles including STAFF;
// create/edit/archive restricted to OWNER/ACCOUNTANT -- same split as
// AccountsController.
@RequireBusinessMembership()
@Controller('api/businesses/:businessId/contacts')
export class ContactsController {
  constructor(
    private readonly contactsService: ContactsService,
    private readonly transactionsService: TransactionsService,
  ) {}

  @Get()
  list(@Param('businessId') businessId: string, @Query() query: ListContactsQueryDto) {
    return this.contactsService.list(businessId, query);
  }

  @Get(':id')
  getOne(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.contactsService.getOne(businessId, id);
  }

  @Get(':id/transactions')
  transactions(@Param('businessId') businessId: string, @Param('id') id: string, @Query() query: ListTransactionsQueryDto) {
    return this.transactionsService.listTransactions(businessId, { ...query, contactId: id });
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Post()
  create(@Param('businessId') businessId: string, @Body() dto: CreateContactDto) {
    return this.contactsService.create(businessId, dto);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Patch(':id')
  update(@Param('businessId') businessId: string, @Param('id') id: string, @Body() dto: UpdateContactDto) {
    return this.contactsService.update(businessId, id, dto);
  }

  @RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
  @Patch(':id/archive')
  archive(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.contactsService.archive(businessId, id);
  }
}
