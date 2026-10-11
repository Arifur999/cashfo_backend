import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Role } from '@prisma/client';
import { credentialAccountData } from '../auth/credential-account.js';
import { hashPassword } from '../auth/password.js';
import { seedReferenceData } from '../database/seed/reference-data.js';

// One-time production setup, run inside the API container:
//
//   docker compose run --rm api node dist/scripts/bootstrap.js --email you@example.com --name "Your Name"
//
// Creates the first super admin and the reference data the product needs
// (src/database/seed/reference-data.ts) -- never the demo accounts the dev
// seed adds. Safe to re-run: an existing super admin with that email is kept
// as it is, and reference data is upserted.

const { values } = parseArgs({ options: { email: { type: 'string' }, name: { type: 'string' } } });
const email = values.email?.trim().toLowerCase();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Usage: node dist/scripts/bootstrap.js --email you@example.com [--name "Your Name"]');
  process.exit(2);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

// Returns the super admin's id, and the temporary password when one was made.
async function ensureSuperAdmin(address: string, name: string): Promise<{ id: string; temporaryPassword?: string }> {
  const existing = await prisma.user.findUnique({ where: { email: address } });
  if (existing) {
    if (existing.role !== Role.SUPER_ADMIN) {
      // Never promote an existing account silently -- that's a decision for a person.
      throw new Error(`${address} already exists with role ${existing.role}; refusing to make it a super admin.`);
    }
    return { id: existing.id };
  }

  const temporaryPassword = randomBytes(12).toString('base64url');
  const passwordHash = await hashPassword(temporaryPassword);
  const admin = await prisma.$transaction(async (tx) => {
    // emailVerified: an address the operator vouches for, like every admin
    // account -- which also lets its Google sign-in link to it.
    const created = await tx.user.create({ data: { name, email: address, role: Role.SUPER_ADMIN, emailVerified: true } });
    await tx.authAccount.create({ data: credentialAccountData(created.id, passwordHash) });
    return created;
  });
  return { id: admin.id, temporaryPassword };
}

async function main(address: string) {
  const admin = await ensureSuperAdmin(address, values.name?.trim() || 'Super Admin');
  await seedReferenceData(prisma, admin.id);

  const [plans, templates, categories, flags, notificationTemplates] = await Promise.all([
    prisma.subscriptionPlan.count(),
    prisma.defaultAccountTemplate.count(),
    prisma.defaultCategory.count(),
    prisma.featureFlag.count(),
    prisma.notificationTemplate.count(),
  ]);

  console.log(admin.temporaryPassword ? `Super admin created: ${address}` : `Super admin already exists: ${address} (unchanged)`);
  console.log(`Reference data: ${plans} plans, ${templates} account templates, ${categories} categories, ${flags} feature flags, ${notificationTemplates} notification templates.`);
  console.log('Legal documents are placeholders -- replace them in Content > Legal before launch.');
  if (admin.temporaryPassword) {
    // Last, on its own line, so it is easy to copy -- and to leave out when
    // sharing the rest of the output.
    console.log(`\nTemporary password (shown once, keep it private): ${admin.temporaryPassword}`);
  }
}

main(email)
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
