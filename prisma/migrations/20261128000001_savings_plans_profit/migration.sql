-- CreateEnum
CREATE TYPE "SavingsPlanHorizon" AS ENUM ('THREE_MONTHS', 'SIX_MONTHS', 'ONE_YEAR', 'TWO_YEARS', 'BY_DATE', 'SOMEDAY');

-- CreateEnum
CREATE TYPE "SavingsPlanPriority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- AlterEnum
ALTER TYPE "SavingsEntryType" ADD VALUE 'PROFIT';

-- AlterTable
ALTER TABLE "SavingsGoal" ADD COLUMN     "color" TEXT;

-- AlterTable
ALTER TABLE "SavingsGoalEntry" ADD COLUMN     "category" TEXT;

-- CreateTable
CREATE TABLE "SavingsPlan" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'others',
    "color" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "horizon" "SavingsPlanHorizon" NOT NULL,
    "needBy" TIMESTAMP(3),
    "priority" "SavingsPlanPriority" NOT NULL DEFAULT 'MEDIUM',
    "note" TEXT,
    "link" TEXT,
    "plannedOn" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavingsPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SavingsPlan_businessId_idx" ON "SavingsPlan"("businessId");

-- AddForeignKey
ALTER TABLE "SavingsPlan" ADD CONSTRAINT "SavingsPlan_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
