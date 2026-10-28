import type { PrismaService } from '../prisma/prisma.service.js';

export interface RequesterPerson {
  id: string;
  name: string;
  email: string;
}

// The person behind a payment: the customer (userId), or for a legacy
// sandbox payment the PlatformUser id it carries.
export const payerIdOf = (payment: { userId?: string | null; platformUserId: string | null }): string | null =>
  payment.userId ?? payment.platformUserId ?? null;

// Who is behind a payment's, ticket's or redemption's person id: a
// customer's User id now, or an id from the legacy PlatformUser table (a
// customer wins).
export async function requesterPeople(prisma: PrismaService, ids: (string | null | undefined)[]): Promise<Map<string, RequesterPerson>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();
  const [users, legacy] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true, email: true } }),
    prisma.platformUser.findMany({ where: { id: { in: unique } }, select: { id: true, name: true, email: true } }),
  ]);
  return new Map([...legacy, ...users].map((person) => [person.id, person]));
}

export async function requesterNames(prisma: PrismaService, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const people = await requesterPeople(prisma, ids);
  return new Map([...people].map(([id, person]) => [id, person.name]));
}
