import { Role, type PrismaClient } from '@prisma/client';
import { hashPassword } from '../../auth/password.js';
import { SEED_PASSWORD, upsertSeedAccount, type SeedAccount } from './seed-account.js';

export async function seedDemoAdmins(prisma: PrismaClient) {
  const passwordHash = await hashPassword(SEED_PASSWORD);

  // Admin accounts count as verified (vouched for, like the ones a super
  // admin creates), which lets their Google sign-in link to them.
  const superAdmin = await upsertSeedAccount(prisma, { name: 'Super Admin', email: 'admin@example.com', role: Role.SUPER_ADMIN, emailVerified: true }, passwordHash);

  // A second seeded account so the "Impersonate is SUPER_ADMIN only" behavior
  // (Prompt 2 completion criteria) can be verified without manually editing
  // the database.
  const supportAdmin = await upsertSeedAccount(prisma, { name: 'Support Admin', email: 'support@example.com', role: Role.SUPPORT_ADMIN, emailVerified: true }, passwordHash);

  // For Prompt 5's "CONTENT_ADMIN can edit, SUPPORT_ADMIN cannot" completion
  // criterion -- seeded rather than requiring a manual temporary account.
  await upsertSeedAccount(prisma, { name: 'Content Admin', email: 'content@example.com', role: Role.CONTENT_ADMIN, emailVerified: true }, passwordHash);

  console.warn(
    '\n⚠️  Seeded admin accounts (admin@/support@/content@/support-admin@/finance-admin@/content-admin@example.com, ' +
      `password ${SEED_PASSWORD}) share a known password -- rotate or delete every one of these before real production use.\n`,
  );

  return { superAdminId: superAdmin.id, supportAdminId: supportAdmin.id };
}

// Prompt 8: additional test accounts distinct from seedDemoAdmins()'s originals --
// mainly here because FINANCE_ADMIN never had a seeded account before this
// (Prompt 4's revenue-visibility check had no way to be tested end-to-end),
// plus more accounts for exercising the Admin Accounts management UI.
export async function seedDemoSubAdmins(prisma: PrismaClient, superAdminId: string) {
  const accounts: SeedAccount[] = [
    { name: 'Support Admin 2', email: 'support-admin@example.com', role: Role.SUPPORT_ADMIN },
    { name: 'Finance Admin', email: 'finance-admin@example.com', role: Role.FINANCE_ADMIN },
    { name: 'Content Admin 2', email: 'content-admin@example.com', role: Role.CONTENT_ADMIN },
  ];

  const passwordHash = await hashPassword(SEED_PASSWORD);
  for (const account of accounts) {
    await upsertSeedAccount(prisma, { ...account, createdBy: superAdminId, emailVerified: true }, passwordHash);
  }
}
