import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateContactDto } from './dto/create-contact.dto.js';
import { ListContactsQueryDto } from './dto/list-contacts-query.dto.js';
import { UpdateContactDto } from './dto/update-contact.dto.js';
import { ReceivablesPayablesService } from '../receivables-payables/receivables-payables.service.js';

@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly receivablesPayablesService: ReceivablesPayablesService,
  ) {}

  async list(businessId: string, filters: ListContactsQueryDto) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;

    // No implicit status filter -- same convention as AccountsService.list(),
    // archived contacts stay visible (frontend shows them struck-through)
    // unless the caller explicitly asks for one status via ?status=.
    const where: Prisma.ContactWhereInput = { businessId };
    if (filters.type) where.type = filters.type;
    if (filters.status) where.status = filters.status;
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { phone: { contains: filters.search, mode: 'insensitive' } },
        { email: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.contact.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.contact.count({ where }),
    ]);

    // currentBalance = openingBalance + outstanding receivable - outstanding
    // payable (see ReceivablesPayablesService.getContactCurrentBalance()).
    // Sequential, not Promise.all -- each call does several queries of its
    // own, and firing all of them for every contact on the page at once
    // multiplies concurrent DB connection demand for no real benefit at
    // this app's realistic contact-list-page size. O(page size), same
    // "acceptable at this app's scale" tradeoff as Prompt 7's ledger
    // pagination -- just spread over time instead of all at once.
    const withBalance: (Prisma.ContactGetPayload<object> & { currentBalance: Prisma.Decimal })[] = [];
    for (const c of data) {
      withBalance.push({ ...c, currentBalance: await this.receivablesPayablesService.getContactCurrentBalance(businessId, c) });
    }

    return {
      data: withBalance,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async getOne(businessId: string, id: string) {
    const contact = await this.requireContact(businessId, id);
    const currentBalance = await this.receivablesPayablesService.getContactCurrentBalance(businessId, contact);
    return { ...contact, currentBalance };
  }

  async create(businessId: string, dto: CreateContactDto) {
    if (!dto.phone && !dto.email) {
      throw new BadRequestException('Provide at least a phone number or an email so this contact can be reached');
    }

    return this.prisma.contact.create({
      data: {
        businessId,
        name: dto.name,
        type: dto.type,
        phone: dto.phone,
        email: dto.email,
        address: dto.address,
        photoUrl: dto.photoUrl,
        openingBalance: dto.openingBalance ?? 0,
        notes: dto.notes,
      },
    });
  }

  async update(businessId: string, id: string, dto: UpdateContactDto) {
    const contact = await this.requireContact(businessId, id);

    const nextPhone = dto.phone !== undefined ? dto.phone : contact.phone;
    const nextEmail = dto.email !== undefined ? dto.email : contact.email;
    if (!nextPhone && !nextEmail) {
      throw new BadRequestException('Provide at least a phone number or an email so this contact can be reached');
    }

    return this.prisma.contact.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.address !== undefined && { address: dto.address }),
        ...(dto.photoUrl !== undefined && { photoUrl: dto.photoUrl }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
    });
  }

  async archive(businessId: string, id: string) {
    const contact = await this.requireContact(businessId, id);

    if (contact.status === 'ARCHIVED') {
      return contact;
    }

    // Same sign-convention balance used everywhere else on this contact --
    // see the Contact model comment. Zero is the only balance that's safe
    // to archive; anything else means money is still owed either direction.
    const currentBalance = await this.receivablesPayablesService.getContactCurrentBalance(businessId, contact);
    if (!currentBalance.equals(0)) {
      throw new BadRequestException(`This contact still has an outstanding balance of ${currentBalance.abs().toFixed(2)}. Settle it before archiving.`);
    }

    return this.prisma.contact.update({ where: { id }, data: { status: 'ARCHIVED' } });
  }

  private async requireContact(businessId: string, id: string) {
    const contact = await this.prisma.contact.findUnique({ where: { id } });
    if (!contact || contact.businessId !== businessId) {
      throw new NotFoundException('Contact not found');
    }
    return contact;
  }
}
