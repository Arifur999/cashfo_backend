import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { seedDemoAdmins, seedDemoSubAdmins } from '../src/database/seed/demo-admins.js';
import { seedDemoCoupons } from '../src/database/seed/demo-coupons.js';
import { seedDemoEndUsers } from '../src/database/seed/demo-end-users.js';
import { seedReferenceData } from '../src/database/seed/reference-data.js';

// Development seed: the reference data production also gets, plus demo admins,
// end users and coupons that all share one known password. Production never
// runs this -- it uses dist/scripts/bootstrap.js, which creates one real super
// admin and the reference data only.
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function main() {
  const { superAdminId } = await seedDemoAdmins(prisma);
  await seedDemoSubAdmins(prisma, superAdminId);
  const { plans } = await seedReferenceData(prisma, superAdminId);
  await seedDemoCoupons(prisma);
  await seedDemoEndUsers(prisma, plans);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
