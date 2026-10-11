import type { PrismaClient, Role } from '@prisma/client';
import { credentialAccountData, credentialAccountKey } from '../../auth/credential-account.js';

// Every demo login shares this known password -- dev data only, never seeded
// in production (see scripts/bootstrap.ts).
export const SEED_PASSWORD = 'ChangeMe123!';

export type SeedAccount = { name: string; email: string; role?: Role; createdBy?: string; preferredLanguage?: 'EN' | 'BN'; emailVerified?: boolean };

// One seeded login: the User row plus its better-auth credential account.
// Accounts that already exist are left exactly as they are.
export async function upsertSeedAccount(prisma: PrismaClient, account: SeedAccount, passwordHash: string) {
  const user = await prisma.user.upsert({ where: { email: account.email }, update: {}, create: account });
  await prisma.authAccount.upsert({
    where: credentialAccountKey(user.id),
    update: {},
    create: credentialAccountData(user.id, passwordHash),
  });
  return user;
}
