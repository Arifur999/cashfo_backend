-- AlterEnum
ALTER TYPE "UserNotificationType" ADD VALUE 'INSIGHT';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "aiMorning" BOOLEAN NOT NULL DEFAULT false;
