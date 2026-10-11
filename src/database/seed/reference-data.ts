import type { PrismaClient } from '@prisma/client';
import { seedAccountTemplatesAndCategories } from './account-templates.js';
import { seedLegalDocuments, seedNotificationTemplates, seedTranslations } from './content.js';
import { seedFeatureFlags } from './feature-flags.js';
import { seedSubscriptionPlans } from './plans.js';

// What the product itself needs in every environment, production included:
// the plans, the default chart of accounts and categories new workspaces are
// built from, translations, legal-document placeholders, feature flags and
// notification templates. Idempotent -- every step upserts or skips rows that
// already exist. adminId is recorded as the author of flags and documents;
// syncPlans resets existing plans to the seed's values (development only).
export async function seedReferenceData(prisma: PrismaClient, adminId: string, { syncPlans = true } = {}) {
  const plans = await seedSubscriptionPlans(prisma, { syncExisting: syncPlans });
  await seedAccountTemplatesAndCategories(prisma);
  await seedTranslations(prisma);
  await seedLegalDocuments(prisma, adminId);
  await seedFeatureFlags(prisma, adminId);
  await seedNotificationTemplates(prisma);
  return { plans };
}
