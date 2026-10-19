-- Password vault: three more categories, the star, the password's own age and
-- the checkup's "It's fine".
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.

ALTER TYPE "VaultEntryCategory" ADD VALUE 'MOBILE_BANKING';
ALTER TYPE "VaultEntryCategory" ADD VALUE 'WIFI';
ALTER TYPE "VaultEntryCategory" ADD VALUE 'GOVERNMENT';

-- AlterTable
ALTER TABLE "VaultEntry" ADD COLUMN     "checkupDismissedAt" TIMESTAMP(3),
ADD COLUMN     "isFavorite" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "passwordChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;


-- A password saved before this was last set at the latest edit, not now.
UPDATE "VaultEntry" SET "passwordChangedAt" = "updatedAt";
