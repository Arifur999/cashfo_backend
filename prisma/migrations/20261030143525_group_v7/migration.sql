-- CreateEnum
CREATE TYPE "GroupCostSplit" AS ENUM ('EQUAL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "GroupMemberRole" AS ENUM ('MEMBER', 'ACCOUNTANT');

-- CreateEnum
CREATE TYPE "GroupActivityAction" AS ENUM ('ADDED', 'EDITED', 'DELETED', 'MONTH');

-- AlterTable
ALTER TABLE "GroupContribution" ADD COLUMN     "receivedByMemberId" TEXT,
ADD COLUMN     "settleGroupId" TEXT;

-- AlterTable
ALTER TABLE "GroupExpenseCategoryOption" ADD COLUMN     "hidden" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "GroupMember" ADD COLUMN     "costPercent" DECIMAL(5,2),
ADD COLUMN     "household" TEXT,
ADD COLUMN     "isOwner" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "role" "GroupMemberRole" NOT NULL DEFAULT 'MEMBER';

-- AlterTable
ALTER TABLE "GroupSettings" ADD COLUMN     "budgetWarnPercent" INTEGER DEFAULT 90,
ADD COLUMN     "costSplit" "GroupCostSplit" NOT NULL DEFAULT 'EQUAL',
ADD COLUMN     "pausedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "GroupActivity" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" "GroupActivityAction" NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "summary" JSONB NOT NULL,
    "change" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GroupActivity_businessId_createdAt_idx" ON "GroupActivity"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "GroupContribution_businessId_receivedByMemberId_idx" ON "GroupContribution"("businessId", "receivedByMemberId");

-- CreateIndex
CREATE INDEX "GroupContribution_settleGroupId_idx" ON "GroupContribution"("settleGroupId");

-- AddForeignKey
ALTER TABLE "GroupContribution" ADD CONSTRAINT "GroupContribution_receivedByMemberId_fkey" FOREIGN KEY ("receivedByMemberId") REFERENCES "GroupMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupActivity" ADD CONSTRAINT "GroupActivity_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Data: the cash holder becomes the group's accountant.
UPDATE "GroupMember" m SET "role" = 'ACCOUNTANT'
FROM "GroupSettings" s
WHERE s."cashHolderMemberId" = m."id";

-- Older deposits and returns went into the cash holder's hands.
UPDATE "GroupContribution" c SET "receivedByMemberId" = s."cashHolderMemberId"
FROM "GroupSettings" s
WHERE s."businessId" = c."businessId" AND s."cashHolderMemberId" IS NOT NULL
  AND c."receivedByMemberId" IS NULL AND c."kind" IN ('DEPOSIT', 'RETURN');

-- Unequal share units become a custom cost split with the same weights, so
-- no balance moves: each member's percent is their units over the active
-- members' total (archived members keep the same proportion).
UPDATE "GroupMember" m SET "costPercent" = ROUND(m."shareUnits" * 100 / t."total", 2)
FROM (
  SELECT "businessId", SUM("shareUnits") AS "total"
  FROM "GroupMember" WHERE "status" = 'ACTIVE'
  GROUP BY "businessId"
  HAVING MIN("shareUnits") <> MAX("shareUnits") AND SUM("shareUnits") > 0
) t
WHERE m."businessId" = t."businessId";

INSERT INTO "GroupSettings" ("id", "businessId", "costSplit", "updatedAt")
SELECT gen_random_uuid()::text, "businessId", 'CUSTOM', CURRENT_TIMESTAMP
FROM "GroupMember" WHERE "status" = 'ACTIVE'
GROUP BY "businessId"
HAVING MIN("shareUnits") <> MAX("shareUnits") AND SUM("shareUnits") > 0
ON CONFLICT ("businessId") DO UPDATE SET "costSplit" = 'CUSTOM';
