-- AlterEnum
ALTER TYPE "OneTimeCodePurpose" ADD VALUE 'RECOVERY_EMAIL';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "recoveryEmail" TEXT;
