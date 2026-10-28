-- CreateEnum
CREATE TYPE "ReferralKind" AS ENUM ('SIGNUP_BONUS', 'COMMISSION');

-- CreateEnum
CREATE TYPE "PayoutMethodType" AS ENUM ('BKASH', 'NAGAD', 'ROCKET', 'BANK');

-- CreateEnum
CREATE TYPE "BankAccountType" AS ENUM ('SAVINGS', 'CURRENT');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('REQUESTED', 'APPROVED', 'PAID', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OneTimeCodePurpose" AS ENUM ('PAYOUT_REQUEST');

-- CreateEnum
CREATE TYPE "OneTimeCodeChannel" AS ENUM ('EMAIL', 'SMS');

-- AlterEnum: ReferralStatus gains the commission statuses. Rebuilt rather
-- than ADD VALUE so the old rule's rows can move to them here: CONFIRMED
-- (earned, not withdrawn) becomes AVAILABLE and WITHDRAWN becomes PAID_OUT.
-- CONFIRMED / WITHDRAWN stay in the type, unused, for a rollback's sake.
ALTER TYPE "ReferralStatus" RENAME TO "ReferralStatus_old";
CREATE TYPE "ReferralStatus" AS ENUM ('JOINED', 'PENDING', 'AVAILABLE', 'PAID_OUT', 'CANCELLED', 'CONFIRMED', 'WITHDRAWN');
ALTER TABLE "Referral" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Referral" ALTER COLUMN "status" TYPE "ReferralStatus"
  USING (CASE "status"::text WHEN 'CONFIRMED' THEN 'AVAILABLE' WHEN 'WITHDRAWN' THEN 'PAID_OUT' ELSE "status"::text END)::"ReferralStatus";
DROP TYPE "ReferralStatus_old";

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.

ALTER TYPE "UserNotificationType" ADD VALUE 'REFERRAL';
ALTER TYPE "UserNotificationType" ADD VALUE 'PAYOUT';

-- AlterTable
ALTER TABLE "Referral" ADD COLUMN     "availableAt" TIMESTAMP(3),
ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "commissionAmount" DECIMAL(14,2),
ADD COLUMN     "commissionRate" DECIMAL(5,2),
ADD COLUMN     "kind" "ReferralKind" NOT NULL DEFAULT 'COMMISSION',
ADD COLUMN     "paidAmount" DECIMAL(14,2),
ADD COLUMN     "paidOutAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "paidOutAt" TIMESTAMP(3),
ADD COLUMN     "paymentId" TEXT,
ALTER COLUMN "status" SET DEFAULT 'JOINED';

-- Data: the old rule's rows become sign-up bonuses under the new columns.
UPDATE "Referral" SET "kind" = 'SIGNUP_BONUS', "commissionAmount" = "rewardAmount";
UPDATE "Referral" SET "availableAt" = COALESCE("confirmedAt", "createdAt") WHERE "status" = 'AVAILABLE';
UPDATE "Referral"
  SET "availableAt" = COALESCE("confirmedAt", "createdAt"), "paidOutAmount" = "rewardAmount", "paidOutAt" = COALESCE("withdrawnAt", "confirmedAt", "createdAt")
  WHERE "status" = 'PAID_OUT';
UPDATE "Referral" AS r SET "availableAt" = u."createdAt" + INTERVAL '30 days'
  FROM "User" AS u
  WHERE u."id" = r."referredUserId" AND r."status" = 'PENDING';

-- CreateTable
CREATE TABLE "PayoutMethod" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "PayoutMethodType" NOT NULL,
    "accountName" TEXT NOT NULL,
    "walletNumber" TEXT,
    "bankName" TEXT,
    "branch" TEXT,
    "bankAccountType" "BankAccountType",
    "accountNumber" TEXT,
    "routingNumber" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutRequest" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "fee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "methodId" TEXT,
    "methodSnapshot" JSONB NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'REQUESTED',
    "incomeBusinessId" TEXT,
    "incomeAccountId" TEXT,
    "incomeTransactionId" TEXT,
    "codeConfirmedAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "paidAt" TIMESTAMP(3),
    "paidAmount" DECIMAL(14,2),
    "trxId" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "processedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutAllocation" (
    "id" TEXT NOT NULL,
    "payoutId" TEXT NOT NULL,
    "referralId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayoutAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OneTimeCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" "OneTimeCodePurpose" NOT NULL,
    "channel" "OneTimeCodeChannel" NOT NULL,
    "destination" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sends" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "lastSentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OneTimeCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayoutMethod_userId_idx" ON "PayoutMethod"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutRequest_number_key" ON "PayoutRequest"("number");

-- CreateIndex
CREATE INDEX "PayoutRequest_status_createdAt_idx" ON "PayoutRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PayoutRequest_userId_createdAt_idx" ON "PayoutRequest"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PayoutAllocation_payoutId_idx" ON "PayoutAllocation"("payoutId");

-- CreateIndex
CREATE INDEX "PayoutAllocation_referralId_idx" ON "PayoutAllocation"("referralId");

-- CreateIndex
CREATE INDEX "OneTimeCode_userId_purpose_idx" ON "OneTimeCode"("userId", "purpose");

-- CreateIndex
CREATE INDEX "OneTimeCode_expiresAt_idx" ON "OneTimeCode"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_paymentId_key" ON "Referral"("paymentId");

-- CreateIndex
CREATE INDEX "Referral_referrerId_status_idx" ON "Referral"("referrerId", "status");

-- CreateIndex
CREATE INDEX "Referral_status_availableAt_idx" ON "Referral"("status", "availableAt");

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutMethod" ADD CONSTRAINT "PayoutMethod_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutRequest" ADD CONSTRAINT "PayoutRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutRequest" ADD CONSTRAINT "PayoutRequest_methodId_fkey" FOREIGN KEY ("methodId") REFERENCES "PayoutMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutAllocation" ADD CONSTRAINT "PayoutAllocation_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "PayoutRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutAllocation" ADD CONSTRAINT "PayoutAllocation_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OneTimeCode" ADD CONSTRAINT "OneTimeCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

