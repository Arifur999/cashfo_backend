-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'SUPPORT_ADMIN', 'FINANCE_ADMIN', 'CONTENT_ADMIN', 'USER');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "emailVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "role" "Role" NOT NULL DEFAULT 'USER';

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- Backfill: the existing timestamp already records who verified.
UPDATE "User" SET "emailVerified" = true WHERE "emailVerifiedAt" IS NOT NULL;
