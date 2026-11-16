-- Who deleted a transaction from the Transactions page and when, and who
-- brought it back (restoreTransaction). Undo now reads these columns
-- instead of matching the void's reason text.
ALTER TABLE "Transaction" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" TEXT,
ADD COLUMN     "restoredAt" TIMESTAMP(3),
ADD COLUMN     "restoredById" TEXT;

-- Deletes made before this release, still voided: the reversal's author is
-- the person who deleted. Keeps a delete made minutes before the deploy
-- undoable.
UPDATE "Transaction" AS t
SET "deletedAt" = t."voidedAt", "deletedById" = r."createdBy"
FROM "Transaction" AS r
WHERE r."reversalOfId" = t."id"
  AND t."status" = 'VOIDED'
  AND t."voidedReason" = 'Deleted from Transactions';
