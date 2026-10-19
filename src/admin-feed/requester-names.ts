import type { PrismaService } from '../prisma/prisma.service.js';

// The name behind a payment's or ticket's platformUserId: a customer's User
// id now, or an id from the legacy PlatformUser table (a customer wins).
export async function requesterNames(prisma: PrismaService, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const [users, legacy] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } }),
    prisma.platformUser.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } }),
  ]);
  return new Map([...legacy, ...users].map((person) => [person.id, person.name]));
}
