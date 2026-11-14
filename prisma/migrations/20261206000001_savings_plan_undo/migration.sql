-- AlterTable
ALTER TABLE "SavingsGoal" ADD COLUMN     "fromPlan" JSONB;

-- AlterTable
ALTER TABLE "SavingsPlan" ADD COLUMN     "fromGoal" JSONB;
