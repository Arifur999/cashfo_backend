import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';

// Creates a row only while the user is under `max` rows of that kind. The
// count and the insert run in one transaction holding a per-user, per-kind
// advisory lock, so parallel requests (a double-submit, a looping client)
// queue behind each other instead of all passing the count at once and
// overshooting the cap.
export async function createWithinCap<T>(
  prisma: PrismaService,
  userId: string,
  kind: string,
  max: number,
  message: string,
  count: (tx: Prisma.TransactionClient) => Promise<number>,
  create: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    // Parameterised (tagged template), released automatically at commit/rollback.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${kind}:${userId}`}))`;
    if ((await count(tx)) >= max) throw new BadRequestException(message);
    return create(tx);
  });
}
