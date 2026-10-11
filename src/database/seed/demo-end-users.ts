import { WorkspaceType, type PrismaClient } from '@prisma/client';
import { hashPassword } from '../../auth/password.js';
import { SEED_PASSWORD, upsertSeedAccount } from './seed-account.js';

// Mirrors AccountsService.seedDefaultAccounts() (src/accounts/accounts.service.ts)
// with a plain PrismaClient -- the seed runs as a standalone script, without
// NestJS DI. Only called for workspaces this seed run actually CREATES
// (guarded by the upsert-style checks below), so re-running the seed never
// double-seeds accounts.
async function seedAccountsForBusiness(prisma: PrismaClient, businessId: string, workspaceType: WorkspaceType) {
  const templates = await prisma.defaultAccountTemplate.findMany({
    where: { appliesTo: { has: workspaceType }, isActive: true },
    orderBy: { displayOrder: 'asc' },
  });

  const templateIdToAccountId = new Map<string, string>();
  for (const template of templates) {
    const account = await prisma.account.create({
      data: {
        businessId,
        name: template.name,
        nameBn: template.nameBn,
        accountType: template.accountType,
        accountSubtype: template.accountSubtype,
        displayOrder: template.displayOrder,
        isSystemAccount: true,
      },
    });
    templateIdToAccountId.set(template.id, account.id);
  }

  for (const template of templates) {
    if (!template.parentId) continue;
    const newParentId = templateIdToAccountId.get(template.parentId);
    const newOwnId = templateIdToAccountId.get(template.id);
    if (newParentId && newOwnId) {
      await prisma.account.update({ where: { id: newOwnId }, data: { parentId: newParentId } });
    }
  }
}

// End-user app (Prompt 1): seeds real User accounts (distinct from
// PlatformUser, which was only ever the admin panel's own separate,
// demo-data read-model -- see AdminOwnersService/AdminWorkspacesService for
// the real replacements built later) plus their Business workspaces, so a
// fresh dev setup has real accounts to log in as. These ARE real,
// functioning logins (not synthetic display data) but are still seed-created
// test fixtures sharing one known password -- rotate or delete them the same
// way as the seeded admin accounts before any real production use.
export async function seedDemoEndUsers(prisma: PrismaClient, plans: { id: string; slug: string }[]) {
  const freePlan = plans.find((p) => p.slug === 'free');
  const proPlan = plans.find((p) => p.slug === 'monthly-pro');
  const passwordHash = await hashPassword(SEED_PASSWORD);

  const testUsers: { name: string; email: string; preferredLanguage: 'EN' | 'BN'; secondBusiness?: boolean }[] = [
    { name: 'Rafiqul Islam', email: 'rafiqul.islam@example.com', preferredLanguage: 'EN' },
    { name: 'নুসরাত জাহান', email: 'nusrat.jahan@example.com', preferredLanguage: 'BN' },
    // Gets a second, BUSINESS-type workspace below to exercise the
    // multi-workspace case -- also the one seeded onto the paid plan.
    { name: 'Tanvir Ahmed', email: 'tanvir.ahmed@example.com', preferredLanguage: 'EN', secondBusiness: true },
    { name: 'শিরিন আক্তার', email: 'shirin.akter@example.com', preferredLanguage: 'BN' },
  ];

  for (const testUser of testUsers) {
    const user = await upsertSeedAccount(prisma, 
      { name: testUser.name, email: testUser.email, preferredLanguage: testUser.preferredLanguage },
      passwordHash,
    );

    let defaultBusiness = await prisma.business.findFirst({ where: { ownerId: user.id, isDefault: true } });
    if (!defaultBusiness) {
      defaultBusiness = await prisma.business.create({
        data: {
          ownerId: user.id,
          name: 'Personal',
          type: WorkspaceType.PERSONAL,
          isDefault: true,
          planId: testUser.secondBusiness ? proPlan?.id : freePlan?.id,
          members: { create: { userId: user.id, role: 'OWNER' } },
        },
      });
    }
    // Checked by account count, not "was this business just created" --
    // Prompt 4 added account-seeding after these test users already existed
    // from Prompt 1's original seed run, so this also retroactively backfills
    // accounts for a business that predates this function ever seeding them.
    if ((await prisma.account.count({ where: { businessId: defaultBusiness.id } })) === 0) {
      await seedAccountsForBusiness(prisma, defaultBusiness.id, WorkspaceType.PERSONAL);
    }

    if (testUser.secondBusiness) {
      let secondBusiness = await prisma.business.findFirst({
        where: { ownerId: user.id, type: WorkspaceType.BUSINESS },
      });
      if (!secondBusiness) {
        secondBusiness = await prisma.business.create({
          data: {
            ownerId: user.id,
            name: `${testUser.name}'s Shop`,
            type: WorkspaceType.BUSINESS,
            isDefault: false,
            planId: proPlan?.id,
            members: { create: { userId: user.id, role: 'OWNER' } },
          },
        });
      }
      if ((await prisma.account.count({ where: { businessId: secondBusiness.id } })) === 0) {
        await seedAccountsForBusiness(prisma, secondBusiness.id, WorkspaceType.BUSINESS);
      }
    }
  }

  console.warn(`\n⚠️  4 end-user test accounts created (password ${SEED_PASSWORD} for all) -- rafiqul.islam@, nusrat.jahan@, tanvir.ahmed@, shirin.akter@example.com.\n`);
}
