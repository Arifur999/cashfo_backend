-- AlterTable
ALTER TABLE "User" ALTER COLUMN "aiReads" SET DEFAULT ARRAY['TRANSACTIONS', 'BUDGET', 'SAVINGS', 'LOANS']::"AiSection"[];

-- Budgets were read with transactions until they got their own tick: keep
-- them for everyone who lets AI Insights read transactions.
UPDATE "User" SET "aiReads" = array_append("aiReads", 'BUDGET') WHERE 'TRANSACTIONS' = ANY("aiReads") AND NOT ('BUDGET' = ANY("aiReads"));
