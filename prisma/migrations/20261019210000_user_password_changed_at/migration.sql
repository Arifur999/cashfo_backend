-- When an account password was last set, for "Last changed 4 months ago".
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "passwordChangedAt" TIMESTAMP(3);

