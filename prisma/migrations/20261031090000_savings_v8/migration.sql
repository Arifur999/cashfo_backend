-- AlterTable
ALTER TABLE "SavingsGoal" ADD COLUMN     "monthlyReminder" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "monthlyReminderSentFor" TEXT,
ADD COLUMN     "planStartAmount" DECIMAL(14,2),
ADD COLUMN     "planStartDate" TIMESTAMP(3),
ADD COLUMN     "reachedAt" TIMESTAMP(3),
ADD COLUMN     "reminderSentFor" TIMESTAMP(3),
ADD COLUMN     "startAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SavingsGoalEntry" ADD COLUMN     "groupId" TEXT;

-- CreateIndex
CREATE INDEX "SavingsGoalEntry_groupId_idx" ON "SavingsGoalEntry"("groupId");

-- Each existing move was one TRANSFER_OUT/TRANSFER_IN pair made together:
-- give both halves the OUT's id, so the move can be listed and undone as
-- one. Twin moves (same goals, amount and day) pair up in the order they
-- were made.
WITH outs AS (
  SELECT id, "savingsGoalId" AS a, "relatedGoalId" AS b, amount, date,
         row_number() OVER (PARTITION BY "savingsGoalId", "relatedGoalId", amount, date ORDER BY "createdAt", id) AS n
  FROM "SavingsGoalEntry" WHERE type = 'TRANSFER_OUT'
), ins AS (
  SELECT id, "relatedGoalId" AS a, "savingsGoalId" AS b, amount, date,
         row_number() OVER (PARTITION BY "relatedGoalId", "savingsGoalId", amount, date ORDER BY "createdAt", id) AS n
  FROM "SavingsGoalEntry" WHERE type = 'TRANSFER_IN'
), pairs AS (
  SELECT outs.id AS out_id, ins.id AS in_id
  FROM outs JOIN ins ON outs.a = ins.a AND outs.b = ins.b AND outs.amount = ins.amount AND outs.date = ins.date AND outs.n = ins.n
)
UPDATE "SavingsGoalEntry" e SET "groupId" = p.out_id FROM pairs p WHERE e.id = p.out_id OR e.id = p.in_id;

-- A Completed goal reached its target; a Withdrawn one did if what was
-- taken out covered the target (older withdrawals took everything).
UPDATE "SavingsGoal" SET "reachedAt" = "updatedAt" WHERE status = 'COMPLETED';
UPDATE "SavingsGoal" g SET "reachedAt" = w.date
FROM (SELECT "savingsGoalId", max(date) AS date, sum(amount) AS total FROM "SavingsGoalEntry" WHERE type = 'WITHDRAWAL' GROUP BY "savingsGoalId") w
WHERE g.id = w."savingsGoalId" AND g.status = 'WITHDRAWN' AND w.total >= g."targetAmount";

-- Reminder days already gone by never email now that reminders are sent.
UPDATE "SavingsGoal" SET "reminderSentFor" = "reminderDate" WHERE "reminderDate" IS NOT NULL AND "reminderDate" < now();
