import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { ReminderDraft } from './reminders.js';

// Adds one row to a customer's feed straight away, for something that
// happened elsewhere (a support reply) rather than being found by the
// checks. Its key keeps it to one row, like theirs.
export async function pushNotification(prisma: PrismaService | Prisma.TransactionClient, userId: string, draft: ReminderDraft): Promise<void> {
  await prisma.userNotification.createMany({
    data: [{ userId, key: draft.key, type: draft.type, businessId: draft.businessId, data: draft.data as Prisma.InputJsonObject }],
    skipDuplicates: true,
  });
}
