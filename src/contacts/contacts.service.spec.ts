import { BadRequestException, NotFoundException, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { Prisma } from '@prisma/client';
import { BUSINESS_ROLES_KEY } from '../business-access/decorators/require-role.decorator.js';
import { ContactsController } from './contacts.controller.js';
import { ContactsService } from './contacts.service.js';

const contact = (over: Record<string, unknown> = {}) => ({
  id: 'rahim',
  businessId: 'biz-1',
  name: 'Rahim Traders',
  type: 'CUSTOMER',
  category: 'LOAN',
  status: 'ARCHIVED',
  openingBalance: new Prisma.Decimal(0),
  ...over,
});

const setup = (found: ReturnType<typeof contact> | null) => {
  const prisma = {
    contact: {
      findUnique: vi.fn().mockResolvedValue(found),
      update: vi.fn(({ data }: { where: { id: string }; data: Record<string, unknown> }) => Promise.resolve({ ...found, ...data })),
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'new', ...data })),
    },
  };
  const receivablesPayables = { getContactCurrentBalance: vi.fn() };
  return { service: new ContactsService(prisma as never, receivablesPayables as never), prisma, receivablesPayables };
};

describe('ContactsService and a way to reach a contact', () => {
  it('keeps a loan contact by name alone, as a bank or a relative may be', async () => {
    const { service, prisma } = setup(contact({ status: 'ACTIVE', phone: '01711223344' }));
    await service.create('biz-1', { name: 'Islami Bank', type: 'BANK', category: 'LOAN' } as never);
    await service.update('biz-1', 'rahim', { phone: '' } as never);
    expect(prisma.contact.create).toHaveBeenCalled();
    expect(prisma.contact.update).toHaveBeenCalled();
  });

  it('still asks a Books contact for a phone or an email', async () => {
    const { service, prisma } = setup(contact({ status: 'ACTIVE', category: 'BUSINESS', phone: '01711223344', email: null }));
    await expect(service.create('biz-1', { name: 'Karim Store', type: 'CUSTOMER' } as never)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.update('biz-1', 'rahim', { phone: '' } as never)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.update('biz-1', 'rahim', { category: 'LOAN', phone: '' } as never)).resolves.toBeDefined();
    expect(prisma.contact.create).not.toHaveBeenCalled();
  });
});

describe('ContactsService.unarchive', () => {
  it('makes an archived contact active again', async () => {
    const { service, prisma, receivablesPayables } = setup(contact());
    await expect(service.unarchive('biz-1', 'rahim')).resolves.toMatchObject({ id: 'rahim', status: 'ACTIVE' });
    expect(prisma.contact.findUnique).toHaveBeenCalledWith({ where: { id: 'rahim' } });
    expect(prisma.contact.update).toHaveBeenCalledWith({ where: { id: 'rahim' }, data: { status: 'ACTIVE' } });
    // Coming back needs no settled balance, unlike going.
    expect(receivablesPayables.getContactCurrentBalance).not.toHaveBeenCalled();
  });

  it('answers an active contact unchanged', async () => {
    const active = contact({ status: 'ACTIVE' });
    const { service, prisma } = setup(active);
    await expect(service.unarchive('biz-1', 'rahim')).resolves.toBe(active);
    expect(prisma.contact.update).not.toHaveBeenCalled();
  });

  it("is a 404 for an unknown contact or another workspace's", async () => {
    const unknown = setup(null);
    await expect(unknown.service.unarchive('biz-1', 'nobody')).rejects.toThrow(NotFoundException);
    const elsewhere = setup(contact({ businessId: 'biz-2' }));
    await expect(elsewhere.service.unarchive('biz-1', 'rahim')).rejects.toThrow(NotFoundException);
    expect(unknown.prisma.contact.update).not.toHaveBeenCalled();
    expect(elsewhere.prisma.contact.update).not.toHaveBeenCalled();
  });
});

describe('ContactsController.unarchive', () => {
  const route = (handler: (...args: never[]) => unknown) => ({
    path: Reflect.getMetadata(PATH_METADATA, handler),
    method: Reflect.getMetadata(METHOD_METADATA, handler),
    roles: Reflect.getMetadata(BUSINESS_ROLES_KEY, handler),
  });

  it('is PATCH :id/unarchive, for owners and accountants as archive is', () => {
    const unarchive = route(ContactsController.prototype.unarchive);
    expect(unarchive).toEqual({ path: ':id/unarchive', method: RequestMethod.PATCH, roles: ['OWNER', 'ACCOUNTANT'] });
    expect(unarchive.roles).toEqual(route(ContactsController.prototype.archive).roles);
  });
});
