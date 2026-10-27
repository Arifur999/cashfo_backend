import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { END_USER_WHERE } from '../common/roles.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { payerIdOf, requesterNames } from './requester-names.js';

const PER_KIND = 5;
// "PAY-20931AB" or "#482AB" (how the panel shortens ids), or a bare prefix.
const ID_PREFIX = /^(?:pay-|#)?([0-9a-f]{4}[0-9a-f-]{0,32})$/i;

// The admin top bar's Ctrl K: customers by name, email or phone; payments
// by id, gateway reference or customer; tickets by id, subject or customer.
@Injectable()
export class AdminSearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(query: string) {
    const term = query.trim();
    if (term.length < 2) return { people: [], payments: [], tickets: [] };
    const contains = { contains: term, mode: 'insensitive' as const };
    const idPrefix = ID_PREFIX.exec(term)?.[1]?.toLowerCase();

    const people = await this.prisma.user.findMany({
      where: { ...END_USER_WHERE, OR: [{ name: contains }, { email: contains }, { phone: contains }] },
      orderBy: { createdAt: 'desc' },
      take: PER_KIND,
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        ownedBusinesses: { where: { isDefault: true, deletedAt: null }, take: 1, select: { trialEndsAt: true, plan: { select: { name: true } } } },
      },
    });
    const personIds = people.map((person) => person.id);

    const paymentWhere: Prisma.PaymentWhereInput[] = [{ gatewayReferenceId: contains }, { userId: { in: personIds } }, { platformUserId: { in: personIds } }];
    const ticketWhere: Prisma.SupportTicketWhereInput[] = [{ subject: contains }, { platformUserId: { in: personIds } }];
    if (idPrefix) {
      paymentWhere.push({ id: { startsWith: idPrefix } });
      ticketWhere.push({ id: { startsWith: idPrefix } });
    }
    const [payments, tickets] = await Promise.all([
      this.prisma.payment.findMany({
        where: { OR: paymentWhere },
        orderBy: { createdAt: 'desc' },
        take: PER_KIND,
        select: { id: true, userId: true, platformUserId: true, amount: true, currency: true, gateway: true, status: true, createdAt: true },
      }),
      this.prisma.supportTicket.findMany({ where: { OR: ticketWhere }, orderBy: { updatedAt: 'desc' }, take: PER_KIND, select: { id: true, subject: true, category: true, status: true, platformUserId: true } }),
    ]);

    const names = await requesterNames(this.prisma, [...payments.map(payerIdOf), ...tickets.map((t) => t.platformUserId)]);
    return {
      people: people.map(({ ownedBusinesses, ...person }) => ({ ...person, plan: ownedBusinesses[0]?.plan?.name ?? null, trialEndsAt: ownedBusinesses[0]?.trialEndsAt ?? null })),
      payments: payments.map(({ userId, platformUserId, amount, ...payment }) => {
        const payer = userId ?? platformUserId;
        return { ...payment, amount: amount.toFixed(2), name: payer ? (names.get(payer) ?? null) : null };
      }),
      tickets: tickets.map(({ platformUserId, ...ticket }) => ({ ...ticket, name: names.get(platformUserId) ?? null })),
    };
  }
}
