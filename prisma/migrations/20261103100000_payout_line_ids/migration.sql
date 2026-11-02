-- A payout request keeps the commission lines it was made of, so a
-- rejected or cancelled one still shows them after they went back.

-- AlterTable
ALTER TABLE "PayoutRequest" ADD COLUMN     "lineIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- The requests that already hold lines (open ones, and paid ones whose lines
-- were paid in them).
UPDATE "PayoutRequest" p
SET "lineIds" = l."ids"
FROM (SELECT "payoutId", array_agg("id" ORDER BY "availableAt", "id") AS "ids" FROM "ReferralCommission" WHERE "payoutId" IS NOT NULL GROUP BY "payoutId") l
WHERE l."payoutId" = p."id";
