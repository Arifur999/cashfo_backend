-- Referral Program v9: a commission on every payment of an invited friend's
-- (ReferralCommission), withdrawals made of whole commission lines, and
-- invite links with their own tags (ReferralLink).

-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('ON_HOLD', 'AVAILABLE', 'IN_WITHDRAWAL', 'UNDER_CHECK', 'PAID_OUT', 'REVERSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CommissionKind" AS ENUM ('FIRST', 'RENEWAL', 'BONUS');

-- AlterTable
ALTER TABLE "PayoutRequest" ADD COLUMN     "requestedAmount" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "Referral" ADD COLUMN     "linkId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "referralEmailEarned" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "referralEmailPayouts" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "referralName" TEXT;

-- CreateTable
CREATE TABLE "ReferralCommission" (
    "id" TEXT NOT NULL,
    "referralId" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "paymentId" TEXT,
    "kind" "CommissionKind" NOT NULL,
    "paidAmount" DECIMAL(14,2) NOT NULL,
    "rate" DECIMAL(5,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "CommissionStatus" NOT NULL,
    "availableAt" TIMESTAMP(3) NOT NULL,
    "payoutId" TEXT,
    "cancelReason" TEXT,
    "paidOutAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralCommission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReferralCommission_paymentId_key" ON "ReferralCommission"("paymentId");

-- CreateIndex
CREATE INDEX "ReferralCommission_referrerId_status_idx" ON "ReferralCommission"("referrerId", "status");

-- CreateIndex
CREATE INDEX "ReferralCommission_referralId_idx" ON "ReferralCommission"("referralId");

-- CreateIndex
CREATE INDEX "ReferralCommission_status_availableAt_idx" ON "ReferralCommission"("status", "availableAt");

-- CreateIndex
CREATE INDEX "ReferralCommission_payoutId_idx" ON "ReferralCommission"("payoutId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralLink_userId_tag_key" ON "ReferralLink"("userId", "tag");

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "ReferralLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralCommission" ADD CONSTRAINT "ReferralCommission_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralCommission" ADD CONSTRAINT "ReferralCommission_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralCommission" ADD CONSTRAINT "ReferralCommission_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralCommission" ADD CONSTRAINT "ReferralCommission_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "PayoutRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralLink" ADD CONSTRAINT "ReferralLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Data: every pre-v9 commission (one per friend, the first payment only) and
-- old sign-up bonus becomes a commission line. Sign-ups that never earned
-- (JOINED, or blocked as self-referral or past the monthly limit) get none.
-- ---------------------------------------------------------------------------

-- The payout a referral's money was last paid in.
CREATE TEMP TABLE "_v9_last_payout" AS
SELECT DISTINCT ON (a."referralId") a."referralId", a."payoutId", p."paidAt"
FROM "PayoutAllocation" a
JOIN "PayoutRequest" p ON p."id" = a."payoutId"
ORDER BY a."referralId", p."paidAt" DESC NULLS LAST;

CREATE TEMP TABLE "_v9_old" AS
SELECT
  r.*,
  COALESCE(r."commissionAmount", CASE WHEN r."kind" = 'SIGNUP_BONUS' THEN r."rewardAmount" ELSE 0 END) AS "earned",
  LEAST(r."paidOutAmount", COALESCE(r."commissionAmount", CASE WHEN r."kind" = 'SIGNUP_BONUS' THEN r."rewardAmount" ELSE 0 END)) AS "paidPart"
FROM "Referral" r
WHERE r."status" <> 'JOINED'
  AND NOT (r."status" = 'CANCELLED' AND r."paymentId" IS NULL AND r."kind" = 'COMMISSION');

-- One line per referral. An available one that was partly paid out keeps
-- what is left here; the paid part is split off below.
INSERT INTO "ReferralCommission" ("id", "referralId", "referrerId", "paymentId", "kind", "paidAmount", "rate", "amount", "status", "availableAt", "payoutId", "cancelReason", "paidOutAt", "endedAt", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  o."id",
  o."referrerId",
  o."paymentId",
  (CASE WHEN o."kind" = 'SIGNUP_BONUS' THEN 'BONUS' ELSE 'FIRST' END)::"CommissionKind",
  COALESCE(o."paidAmount", 0),
  COALESCE(o."commissionRate", 0),
  CASE WHEN o."status" IN ('AVAILABLE', 'CONFIRMED') AND o."earned" - o."paidPart" > 0 THEN o."earned" - o."paidPart" ELSE o."earned" END,
  (CASE
    WHEN o."status" = 'PENDING' THEN 'ON_HOLD'
    WHEN o."status" IN ('AVAILABLE', 'CONFIRMED') AND o."earned" - o."paidPart" > 0 THEN 'AVAILABLE'
    WHEN o."status" IN ('AVAILABLE', 'CONFIRMED', 'PAID_OUT', 'WITHDRAWN') THEN 'PAID_OUT'
    WHEN o."cancelReason" = 'FRIEND_REFUNDED' THEN 'REVERSED'
    ELSE 'CANCELLED'
  END)::"CommissionStatus",
  COALESCE(o."availableAt", o."confirmedAt", o."createdAt"),
  CASE WHEN o."status" IN ('PAID_OUT', 'WITHDRAWN') OR (o."status" IN ('AVAILABLE', 'CONFIRMED') AND o."earned" - o."paidPart" <= 0) THEN lp."payoutId" END,
  CASE WHEN o."status" = 'CANCELLED' THEN o."cancelReason" END,
  CASE WHEN o."status" IN ('PAID_OUT', 'WITHDRAWN') OR (o."status" IN ('AVAILABLE', 'CONFIRMED') AND o."earned" - o."paidPart" <= 0) THEN COALESCE(o."paidOutAt", o."withdrawnAt", lp."paidAt") END,
  CASE WHEN o."status" = 'CANCELLED' THEN COALESCE(o."cancelledAt", o."createdAt") END,
  o."createdAt",
  CURRENT_TIMESTAMP
FROM "_v9_old" o
LEFT JOIN "_v9_last_payout" lp ON lp."referralId" = o."id";

-- The paid part of a partly paid-out available commission, as its own
-- PAID_OUT line (no payment: the payment stays with the line above).
INSERT INTO "ReferralCommission" ("id", "referralId", "referrerId", "paymentId", "kind", "paidAmount", "rate", "amount", "status", "availableAt", "payoutId", "paidOutAt", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  o."id",
  o."referrerId",
  NULL,
  (CASE WHEN o."kind" = 'SIGNUP_BONUS' THEN 'BONUS' ELSE 'FIRST' END)::"CommissionKind",
  0,
  COALESCE(o."commissionRate", 0),
  o."paidPart",
  'PAID_OUT'::"CommissionStatus",
  COALESCE(o."availableAt", o."confirmedAt", o."createdAt"),
  lp."payoutId",
  COALESCE(lp."paidAt", o."createdAt"),
  o."createdAt",
  CURRENT_TIMESTAMP
FROM "_v9_old" o
LEFT JOIN "_v9_last_payout" lp ON lp."referralId" = o."id"
WHERE o."status" IN ('AVAILABLE', 'CONFIRMED') AND o."paidPart" > 0 AND o."earned" - o."paidPart" > 0;

-- What every existing request asked for.
UPDATE "PayoutRequest" SET "requestedAmount" = "amount";

-- Requests still open (asked for an amount, before lines) take whole
-- available lines, oldest first, until they cover the amount; the request
-- becomes the lines' total, so nothing is paid twice or left half-paid.
DO $$
DECLARE
  req RECORD;
  line RECORD;
  got NUMERIC;
BEGIN
  FOR req IN SELECT "id", "userId", "amount" FROM "PayoutRequest" WHERE "status" IN ('REQUESTED', 'APPROVED') ORDER BY "number" LOOP
    got := 0;
    FOR line IN
      SELECT "id", "amount" FROM "ReferralCommission"
      WHERE "referrerId" = req."userId" AND "status" = 'AVAILABLE'
      ORDER BY "availableAt", "createdAt", "id"
    LOOP
      EXIT WHEN got >= req."amount";
      UPDATE "ReferralCommission" SET "status" = 'IN_WITHDRAWAL', "payoutId" = req."id", "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = line."id";
      got := got + line."amount";
    END LOOP;
    IF got > 0 THEN
      UPDATE "PayoutRequest" SET "amount" = got WHERE "id" = req."id";
    END IF;
  END LOOP;
END $$;

DROP TABLE "_v9_old";
DROP TABLE "_v9_last_payout";

-- The smallest withdrawal is now ৳ 300 (it was ৳ 500); a stored 500 was the
-- old default, saved along with the other rules.
UPDATE "PlatformSetting" SET "value" = '300'::jsonb, "updatedAt" = CURRENT_TIMESTAMP WHERE "key" = 'referral_min_withdrawal' AND "value" = '500'::jsonb;
