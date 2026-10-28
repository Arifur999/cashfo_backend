-- CreateEnum
CREATE TYPE "LegalDocVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "DigitStyle" AS ENUM ('LATIN', 'BENGALI');

-- CreateEnum
CREATE TYPE "NumberGrouping" AS ENUM ('LAKH', 'INTERNATIONAL');

-- CreateEnum
CREATE TYPE "DateStyle" AS ENUM ('D_MMM_YYYY', 'DD_MM_YYYY', 'YYYY_MM_DD');

-- CreateEnum
CREATE TYPE "WeekStart" AS ENUM ('SATURDAY', 'SUNDAY', 'MONDAY');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OneTimeCodePurpose" ADD VALUE 'VAULT_RESET';
ALTER TYPE "OneTimeCodePurpose" ADD VALUE 'PASSWORD_RESET';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UserNotificationType" ADD VALUE 'CAMPAIGN';
ALTER TYPE "UserNotificationType" ADD VALUE 'IDEA';

-- AlterEnum
ALTER TYPE "UserStatus" ADD VALUE 'PENDING_DELETION';

-- AlterTable
ALTER TABLE "BulkNotificationCampaign" ADD COLUMN     "sentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "emailedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "NotificationLog" ADD COLUMN     "campaignId" TEXT;

-- AlterTable
ALTER TABLE "SuspiciousActivityFlag" ADD COLUMN     "dedupeKey" TEXT,
ADD COLUMN     "relatedUserId" TEXT;

-- AlterTable
ALTER TABLE "TicketMessage" ADD COLUMN     "isInternal" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "alertFailedTries" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "alertNewDevice" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "askCodeBeforeReset" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dateStyle" "DateStyle" NOT NULL DEFAULT 'D_MMM_YYYY',
ADD COLUMN     "deletionRequestedAt" TIMESTAMP(3),
ADD COLUMN     "deletionScheduledFor" TIMESTAMP(3),
ADD COLUMN     "digitStyle" "DigitStyle",
ADD COLUMN     "failedTriesAlertedAt" TIMESTAMP(3),
ADD COLUMN     "monthlySummaryEmail" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "monthlySummarySentFor" TEXT,
ADD COLUMN     "numberGrouping" "NumberGrouping" NOT NULL DEFAULT 'LAKH',
ADD COLUMN     "vaultLockMinutes" INTEGER,
ADD COLUMN     "vaultUnlockFailedAt" TIMESTAMP(3),
ADD COLUMN     "vaultUnlockFailures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "weekStart" "WeekStart" NOT NULL DEFAULT 'SATURDAY';

-- CreateTable
CREATE TABLE "LegalDocumentVersion" (
    "id" TEXT NOT NULL,
    "type" "LegalDocType" NOT NULL,
    "version" INTEGER NOT NULL,
    "contentEn" TEXT NOT NULL,
    "contentBn" TEXT,
    "status" "LegalDocVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "createdBy" TEXT,
    "publishedBy" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalDocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedReply" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "bodyEn" TEXT NOT NULL,
    "bodyBn" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedReply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminNote" (
    "id" TEXT NOT NULL,
    "subjectUserId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "AdminNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailVerificationToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LegalDocumentVersion_type_status_idx" ON "LegalDocumentVersion"("type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LegalDocumentVersion_type_version_key" ON "LegalDocumentVersion"("type", "version");

-- CreateIndex
CREATE INDEX "AdminNote_subjectUserId_createdAt_idx" ON "AdminNote"("subjectUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key" ON "EmailVerificationToken"("tokenHash");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_userId_idx" ON "EmailVerificationToken"("userId");

-- CreateIndex
CREATE INDEX "NotificationLog_campaignId_idx" ON "NotificationLog"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "SuspiciousActivityFlag_dedupeKey_key" ON "SuspiciousActivityFlag"("dedupeKey");

-- CreateIndex
CREATE INDEX "User_status_deletionScheduledFor_idx" ON "User"("status", "deletionScheduledFor");

-- AddForeignKey
ALTER TABLE "AdminNote" ADD CONSTRAINT "AdminNote_subjectUserId_fkey" FOREIGN KEY ("subjectUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminNote" ADD CONSTRAINT "AdminNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailVerificationToken" ADD CONSTRAINT "EmailVerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

