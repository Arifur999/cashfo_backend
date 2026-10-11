import type { PrismaClient } from '@prisma/client';
import { seedAccountTemplatesAndCategories } from './account-templates.js';
import { seedLegalDocuments, seedNotificationTemplates, seedTranslations } from './content.js';
import { seedFeatureFlags } from './feature-flags.js';
import { seedSubscriptionPlans } from './plans.js';

// What the product itself needs in every environment, production included:
// the plans, the default chart of accounts and categories new workspaces are
// built from, translations, legal-document placeholders, feature flags and
// notification templates. Idempotent -- every step upserts or skips rows that
// already exist. adminId is recorded as the author of flags and documents.
export async function seedReferenceData(prisma: PrismaClient, adminId: string) {
  const plans = await seedSubscriptionPlans(prisma);
  await seedAccountTemplatesAndCategories(prisma);
  await seedTranslations(prisma);
  await seedLegalDocuments(prisma, adminId);
  await seedFeatureFlags(prisma, adminId);
  await seedNotificationTemplates(prisma);
  return { plans };
}
