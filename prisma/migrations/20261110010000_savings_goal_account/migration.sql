-- The savings account a goal keeps its money in (Savings Goals' "Keep the
-- money in"). An existing goal takes the account its latest deposit went to.
ALTER TABLE "SavingsGoal" ADD COLUMN "accountId" TEXT;

CREATE INDEX "SavingsGoal_accountId_idx" ON "SavingsGoal"("accountId");

ALTER TABLE "SavingsGoal" ADD CONSTRAINT "SavingsGoal_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "SavingsGoal" g
SET "accountId" = (
  SELECT e."savingsAccountId"
  FROM "SavingsGoalEntry" e
  WHERE e."savingsGoalId" = g."id" AND e."type" = 'CONTRIBUTION' AND e."savingsAccountId" IS NOT NULL
  ORDER BY e."date" DESC, e."createdAt" DESC
  LIMIT 1
);
