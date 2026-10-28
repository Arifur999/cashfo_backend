-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PaymentPurpose" AS ENUM ('NEW', 'RENEWAL', 'UPGRADE');

-- AlterEnum
ALTER TYPE "UserNotificationType" ADD VALUE 'BILLING';

-- DropIndex
DROP INDEX "Payment_status_idx";

-- AlterTable
ALTER TABLE "Coupon" ADD COLUMN     "oncePerPerson" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "CouponRedemption" ADD COLUMN     "paymentId" TEXT,
ADD COLUMN     "userId" TEXT,
ALTER COLUMN "platformUserId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "listPrice" DECIMAL(10,2),
ADD COLUMN     "markedPaidBy" TEXT,
ADD COLUMN     "payerAccount" TEXT,
ADD COLUMN     "periodEnd" TIMESTAMP(3),
ADD COLUMN     "periodStart" TIMESTAMP(3),
ADD COLUMN     "purpose" "PaymentPurpose" NOT NULL DEFAULT 'NEW',
ADD COLUMN     "referralDiscount" DECIMAL(10,2),
ADD COLUMN     "userId" TEXT,
ALTER COLUMN "platformUserId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "PlanChangeLog" ADD COLUMN     "userId" TEXT,
ALTER COLUMN "platformUserId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "UserSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "trialEndsAt" TIMESTAMP(3),
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "lockedPrice" DECIMAL(10,2),
    "trialUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserSubscription_userId_key" ON "UserSubscription"("userId");

-- CreateIndex
CREATE INDEX "UserSubscription_status_currentPeriodEnd_idx" ON "UserSubscription"("status", "currentPeriodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "CouponRedemption_paymentId_key" ON "CouponRedemption"("paymentId");

-- CreateIndex
CREATE INDEX "CouponRedemption_couponId_userId_idx" ON "CouponRedemption"("couponId", "userId");

-- CreateIndex
CREATE INDEX "Payment_userId_createdAt_idx" ON "Payment"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_status_expiresAt_idx" ON "Payment"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "PlanChangeLog_userId_createdAt_idx" ON "PlanChangeLog"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "UserSubscription" ADD CONSTRAINT "UserSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSubscription" ADD CONSTRAINT "UserSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: one subscription per customer, on their default workspace's
-- plan (the free plan when it has none), ACTIVE with no period. A customer
-- an admin put on a paid plan before this keeps it with no end date until
-- an admin sets one.
INSERT INTO "UserSubscription" ("id", "userId", "planId", "status", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, u."id", COALESCE(b."planId", f."id"), 'ACTIVE', NOW(), NOW()
FROM "User" u
LEFT JOIN LATERAL (
  SELECT "planId" FROM "Business"
  WHERE "ownerId" = u."id" AND "isDefault" = true AND "deletedAt" IS NULL
  ORDER BY "createdAt" ASC
  LIMIT 1
) b ON true
LEFT JOIN LATERAL (SELECT "id" FROM "SubscriptionPlan" WHERE "slug" = 'free' LIMIT 1) f ON true
WHERE u."role" = 'USER' AND COALESCE(b."planId", f."id") IS NOT NULL
ON CONFLICT ("userId") DO NOTHING;

-- A payment whose loose platformUserId is in fact a customer's User id is
-- linked to them.
UPDATE "Payment" p SET "userId" = p."platformUserId"
WHERE p."userId" IS NULL AND EXISTS (SELECT 1 FROM "User" u WHERE u."id" = p."platformUserId" AND u."role" = 'USER');
